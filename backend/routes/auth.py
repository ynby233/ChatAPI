from __future__ import annotations

import base64
import hashlib
import hmac
import io
import secrets
import time
import urllib.parse
import urllib.request
from logging import Logger

from flask import Flask, current_app, jsonify, request, session

from ..core import AuthContext, Settings
from ..core.auth import build_totp_uri, generate_totp_secret, verify_totp_code
from ..repositories import SystemConfigStore, UserStore
from ..services.email import get_available_email_providers, resolve_email_provider, send_verification_email


# In-memory verification code store: { email: (code, expiry_timestamp) }
_verification_codes: dict[str, tuple[str, float]] = {}
_CODE_TTL = 300  # 5 minutes


def _cleanup_expired_codes() -> None:
    now = time.time()
    expired = [email for email, (_, exp) in _verification_codes.items() if now > exp]
    for email in expired:
        del _verification_codes[email]


def register_auth_routes(
    app: Flask,
    *,
    auth: AuthContext,
    settings: Settings,
    system_config_store: SystemConfigStore,
    user_store: UserStore,
) -> None:

    def _get_logger() -> Logger:
        return current_app.logger

    def _check_registration_email_domain(email: str) -> str | None:
        if system_config_store.is_registration_email_allowed(email):
            return None
        domains = system_config_store.get_registration_email_domains()
        if not domains:
            return "当前已开启邮箱域名限制，但未配置允许的域名"
        return "该邮箱域名不允许注册"

    @app.get("/api/auth/register/config")
    def register_config():
        ext_reg = system_config_store.get_system_config("flag.external_registration", "0") == "1"
        email_ver = system_config_store.get_system_config("flag.email_verification", "0") == "1"
        domain_restriction = system_config_store.get_system_config(
            "flag.registration_email_domain_restriction",
            "0",
        ) == "1"
        allowed_domains = ",".join(system_config_store.get_registration_email_domains())
        geetest_enabled = bool(settings.geetest_captcha_id)
        return {
            "ok": True,
            "registration_enabled": ext_reg,
            "email_verification_enabled": ext_reg and email_ver,
            "registration_email_domain_restriction_enabled": domain_restriction,
            "registration_email_domains": allowed_domains,
            "geetest_enabled": geetest_enabled,
            "geetest_captcha_id": settings.geetest_captcha_id if geetest_enabled else "",
        }

    @app.post("/api/auth/register/send-code")
    def register_send_code():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()

        if not email or "@" not in email:
            return jsonify({"error": "请输入有效的邮箱地址"}), 400

        ext_reg = system_config_store.get_system_config("flag.external_registration", "0") == "1"
        if not ext_reg:
            return jsonify({"error": "注册功能未开放"}), 403

        domain_error = _check_registration_email_domain(email)
        if domain_error is not None:
            return jsonify({"error": domain_error}), 403

        existing = user_store.get_user_by_username(email)
        if existing is not None:
            return jsonify({"error": "该邮箱已注册"}), 400

        _cleanup_expired_codes()

        code = f"{secrets.randbelow(1000000):06d}"
        _verification_codes[email] = (code, time.time() + _CODE_TTL)

        provider = resolve_email_provider(
            system_config_store.get_system_config("value.email_provider", ""),
            get_available_email_providers(),
        )
        ok, message = send_verification_email(email, code, provider=provider, logger=_get_logger())
        if not ok:
            return jsonify({"error": message}), 400

        return {"ok": True, "message": "验证码已发送"}

    @app.post("/api/auth/register")
    def register():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        code = str(data.get("code", "")).strip()
        geetest_params = data.get("geetest_params")

        if not email or "@" not in email:
            return jsonify({"error": "请输入有效的邮箱地址"}), 400
        if len(password) < 4:
            return jsonify({"error": "密码至少需要 4 个字符"}), 400

        ext_reg = system_config_store.get_system_config("flag.external_registration", "0") == "1"
        if not ext_reg:
            return jsonify({"error": "注册功能未开放"}), 403

        domain_error = _check_registration_email_domain(email)
        if domain_error is not None:
            return jsonify({"error": domain_error}), 403

        existing = user_store.get_user_by_username(email)
        if existing is not None:
            return jsonify({"error": "该邮箱已注册"}), 400

        # Email verification check
        email_ver = system_config_store.get_system_config("flag.email_verification", "0") == "1"
        if email_ver:
            if not code:
                return jsonify({"error": "请输入邮箱验证码"}), 400
            stored = _verification_codes.get(email)
            if stored is None:
                return jsonify({"error": "请先获取验证码"}), 400
            stored_code, expiry = stored
            if time.time() > expiry:
                del _verification_codes[email]
                return jsonify({"error": "验证码已过期，请重新获取"}), 400
            if code != stored_code:
                return jsonify({"error": "验证码不正确"}), 400
            del _verification_codes[email]

        # GeeTest verification
        if settings.geetest_captcha_id:
            if not geetest_params or not isinstance(geetest_params, dict):
                return jsonify({"error": "请完成人机验证"}), 400

            lot_number = geetest_params.get("lot_number", "")
            captcha_output = geetest_params.get("captcha_output", "")
            pass_token = geetest_params.get("pass_token", "")
            gen_time = geetest_params.get("gen_time", "")

            if not all([lot_number, captcha_output, pass_token, gen_time]):
                return jsonify({"error": "人机验证参数不完整"}), 400

            sign_token = hmac.new(
                settings.geetest_captcha_key.encode(),
                lot_number.encode(),
                digestmod=hashlib.sha256,
            ).hexdigest()

            params = {
                "lot_number": lot_number,
                "captcha_output": captcha_output,
                "pass_token": pass_token,
                "gen_time": gen_time,
                "sign_token": sign_token,
            }
            api_url = f"{settings.geetest_api_server}/validate?captcha_id={settings.geetest_captcha_id}"

            try:
                encoded = urllib.parse.urlencode(params).encode()
                req = urllib.request.Request(api_url, data=encoded, method="POST")
                req.add_header("Content-Type", "application/x-www-form-urlencoded")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    result = resp.read().decode()
                import json as _json
                gt_result = _json.loads(result)
            except Exception as exc:
                _get_logger().warning("[GeeTest] validation request failed: %s", exc)
                gt_result = {"result": "success", "reason": "request geetest api fail"}

            if gt_result.get("result") != "success":
                return jsonify({"error": "人机验证失败，请重试"}), 400

        user = user_store.create_user(email, password, role="user")
        session["user_id"] = user.id
        session["username"] = user.username
        session["role"] = user.role
        user_store.update_last_login_at(user.id)
        return {"ok": True, "user": user.to_dict()}, 201

    @app.post("/api/auth/login")
    def login():
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        totp = str(data.get("totp", "")).strip()

        user = user_store.verify_user_password(username, password)
        if user is None:
            return jsonify({"error": "账号或密码不正确"}), 401

        if user.totp_secret:
            if not totp or not verify_totp_code(user.totp_secret, totp):
                return jsonify({"error": "验证码不正确", "totp_required": True}), 401

        session["user_id"] = user.id
        session["username"] = user.username
        session["role"] = user.role
        user_store.update_last_login_at(user.id)
        return {"ok": True, "user": user.to_dict()}

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return {"ok": True}

    @app.get("/api/auth/session")
    def auth_session():
        user = auth.current_user()
        ext_reg = system_config_store.get_system_config("flag.external_registration", "0") == "1"
        if user is None:
            return {"authenticated": False, "user": None, "registration_enabled": ext_reg}

        db_user = user_store.get_user(user["id"])
        totp_enabled = bool(db_user and db_user.totp_secret)
        return {
            "authenticated": True,
            "user": user,
            "totp_enabled": totp_enabled,
            "registration_enabled": ext_reg,
        }

    @app.get("/api/auth/totp/setup")
    @auth.require_session_auth
    def totp_setup():
        user = auth.current_user()
        if user is None:
            return jsonify({"error": "unauthorized"}), 401

        db_user = user_store.get_user(user["id"])
        if db_user is None:
            return jsonify({"error": "user not found"}), 404

        if db_user.totp_secret:
            return jsonify({"error": "TOTP 已启用，请先重置"}), 400

        secret = generate_totp_secret()
        uri = build_totp_uri(secret, db_user.username)

        try:
            import qrcode
            img = qrcode.make(uri)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            qr_base64 = base64.b64encode(buf.getvalue()).decode()
        except ImportError:
            qr_base64 = ""

        return {
            "ok": True,
            "secret": secret,
            "uri": uri,
            "qr_base64": qr_base64,
        }

    @app.post("/api/auth/totp/confirm")
    @auth.require_session_auth
    def totp_confirm():
        user = auth.current_user()
        if user is None:
            return jsonify({"error": "unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        secret = str(data.get("secret", "")).strip()
        code = str(data.get("code", "")).strip()

        if not secret or not code:
            return jsonify({"error": "secret 和 code 不能为空"}), 400

        if not verify_totp_code(secret, code):
            return jsonify({"error": "验证码不正确"}), 400

        user_store.update_user_totp_secret(user["id"], secret)
        return {"ok": True}

    @app.post("/api/auth/totp/reset")
    @auth.require_session_auth
    def totp_reset():
        user = auth.current_user()
        if user is None:
            return jsonify({"error": "unauthorized"}), 401

        user_store.update_user_totp_secret(user["id"], "")
        return {"ok": True}
