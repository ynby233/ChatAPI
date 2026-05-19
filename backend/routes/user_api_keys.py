from __future__ import annotations

import secrets

from flask import Flask, jsonify, request

from ..core import AuthContext
from ..repositories import UserStore


def register_user_api_key_routes(app: Flask, *, auth: AuthContext, user_store: UserStore) -> None:

    @app.get("/api/user/api-keys")
    @auth.require_auth
    def list_api_keys():
        owner_id = auth.owner_id()
        keys = user_store.list_api_keys(owner_id)
        return {"ok": True, "api_keys": [k.to_dict() for k in keys]}

    @app.post("/api/user/api-keys")
    @auth.require_auth
    def create_api_key():
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        custom_key = str(data.get("api_key", "")).strip()

        owner_id = auth.owner_id()
        try:
            if custom_key:
                key_obj, raw_key = user_store.create_api_key(owner_id, name, custom_key)
            else:
                key_obj, raw_key = user_store.create_api_key(owner_id, name)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        return {"ok": True, "api_key": key_obj.to_dict()}, 201

    @app.delete("/api/user/api-keys/<key_id>")
    @auth.require_auth
    def delete_api_key(key_id: str):
        owner_id = auth.owner_id()
        if not user_store.delete_api_key(owner_id, key_id):
            return jsonify({"error": "API Key 不存在"}), 404
        return {"ok": True}

    @app.get("/api/user/api-keys/generate")
    @auth.require_auth
    def generate_api_key():
        return {"ok": True, "api_key": f"sk-{secrets.token_urlsafe(32)}"}
