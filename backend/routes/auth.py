from __future__ import annotations

import io
import base64

from flask import Flask, jsonify, request, session

from ..core import AuthContext, Settings
from ..core.auth import build_totp_uri, generate_totp_secret, verify_totp_code
from ..repositories import UserStore


def register_auth_routes(app: Flask, *, auth: AuthContext, settings: Settings, user_store: UserStore) -> None:

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
        if user is None:
            return {"authenticated": False, "user": None}

        db_user = user_store.get_user(user["id"])
        totp_enabled = bool(db_user and db_user.totp_secret)
        return {
            "authenticated": True,
            "user": user,
            "totp_enabled": totp_enabled,
        }

    @app.get("/api/auth/totp/setup")
    @auth.require_auth
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
    @auth.require_auth
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
    @auth.require_auth
    def totp_reset():
        user = auth.current_user()
        if user is None:
            return jsonify({"error": "unauthorized"}), 401

        user_store.update_user_totp_secret(user["id"], "")
        return {"ok": True}
