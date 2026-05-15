from __future__ import annotations

from flask import Flask, jsonify, request, session

from ..core import AuthContext, Settings


def register_auth_routes(app: Flask, *, auth: AuthContext, settings: Settings) -> None:
    @app.post("/api/auth/login")
    def login():
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        if username != settings.username or password != settings.password:
            return jsonify({"error": "账号或密码不正确"}), 401
        session["username"] = username
        return {"ok": True, "user": {"username": username}}

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return {"ok": True}

    @app.get("/api/auth/session")
    def auth_session():
        user = auth.current_user()
        return {"authenticated": bool(user), "user": user}
