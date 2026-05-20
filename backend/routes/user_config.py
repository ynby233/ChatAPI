from __future__ import annotations

from flask import Flask, jsonify, request

from ..core import AuthContext
from ..repositories import UserStore


def register_user_config_routes(app: Flask, *, auth: AuthContext, user_store: UserStore) -> None:

    @app.get("/api/user/config")
    @auth.require_session_auth
    def get_user_config():
        owner_id = auth.owner_id()
        return {
            "ok": True,
            **user_store.get_user_config_snapshot(owner_id),
        }

    @app.post("/api/user/config")
    @auth.require_session_auth
    def update_user_config():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"error": "request body must be a JSON object"}), 400

        owner_id = auth.owner_id()
        try:
            user_store.update_user_config_snapshot(owner_id, data)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        return {
            "ok": True,
            **user_store.get_user_config_snapshot(owner_id),
        }

    @app.post("/api/user/password")
    @auth.require_session_auth
    def reset_own_password():
        data = request.get_json(silent=True) or {}
        password = str(data.get("password", ""))

        if len(password) < 4:
            return jsonify({"error": "密码至少需要 4 个字符"}), 400

        owner_id = auth.owner_id()
        if not user_store.update_user_password(owner_id, password):
            return jsonify({"error": "用户不存在"}), 404

        return {"ok": True}
