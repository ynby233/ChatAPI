from __future__ import annotations

from flask import Flask, current_app, jsonify, request

from ..core import AuthContext
from ..repositories import ConversationStore, UserStore
from ..services.email import resolve_email_provider, get_available_email_providers, send_test_email


def register_admin_routes(
    app: Flask,
    *,
    auth: AuthContext,
    store: ConversationStore,
    user_store: UserStore,
) -> None:

    @app.get("/api/admin/users")
    @auth.require_admin
    def list_users():
        users = user_store.list_users()
        key_counts = user_store.get_api_key_counts()
        result = []
        for u in users:
            d = u.to_dict()
            d["api_key_count"] = key_counts.get(u.id, 0)
            result.append(d)
        return {"ok": True, "users": result}

    @app.post("/api/admin/users")
    @auth.require_admin
    def create_user():
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        role = str(data.get("role", "user")).strip()

        if not username:
            return jsonify({"error": "用户名不能为空"}), 400
        if len(password) < 4:
            return jsonify({"error": "密码至少需要 4 个字符"}), 400
        if role not in ("admin", "user"):
            return jsonify({"error": "role 必须是 admin 或 user"}), 400

        existing = user_store.get_user_by_username(username)
        if existing is not None:
            return jsonify({"error": "用户名已存在"}), 400

        user = user_store.create_user(username, password, role)
        return {"ok": True, "user": user.to_dict()}, 201

    @app.delete("/api/admin/users/<user_id>")
    @auth.require_admin
    def delete_user(user_id: str):
        current = auth.current_user()
        if current and current["id"] == user_id:
            return jsonify({"error": "不能删除自己"}), 400

        if user_store.get_user(user_id) is None:
            return jsonify({"error": "用户不存在"}), 404

        store.delete_owner_conversations(user_id)
        if not user_store.delete_user(user_id):
            return jsonify({"error": "用户不存在"}), 404
        return {"ok": True}

    @app.put("/api/admin/users/<user_id>/password")
    @auth.require_admin
    def change_user_password(user_id: str):
        data = request.get_json(silent=True) or {}
        password = str(data.get("password", ""))

        if len(password) < 4:
            return jsonify({"error": "密码至少需要 4 个字符"}), 400

        if not user_store.update_user_password(user_id, password):
            return jsonify({"error": "用户不存在"}), 404

        return {"ok": True}

    @app.post("/api/admin/send-test-email")
    @auth.require_admin
    def send_test_email_route():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip()

        if not email or "@" not in email:
            return jsonify({"error": "请输入有效的邮箱地址"}), 400

        system_config_store = current_app.extensions.get("chat_system_config_store")
        provider = ""
        if system_config_store is not None:
            provider = resolve_email_provider(
                system_config_store.get_system_config("value.email_provider", ""),
                get_available_email_providers(),
            )

        ok, message = send_test_email(email, provider=provider, logger=current_app.logger)
        if ok:
            return {"ok": True, "message": message}
        return jsonify({"error": message}), 400
