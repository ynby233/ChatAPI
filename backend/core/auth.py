from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from flask import jsonify, request, session

from .config import Settings


class AuthContext:
    def __init__(self, settings: Settings):
        self.settings = settings

    def current_user(self) -> dict[str, str] | None:
        username = str(session.get("username", "") or "").strip()
        if username:
            return {"username": username}
        return None

    def request_api_key(self) -> str:
        return str(
            request.headers.get("Authorization", "").removeprefix("Bearer ")
            or request.headers.get("X-API-Key", "")
            or ""
        ).strip()

    def is_request_authorized_by_api_key(self) -> bool:
        return bool(self.settings.api_key) and self.request_api_key() == self.settings.api_key

    def owner_id(self) -> str:
        if self.current_user() or self.is_request_authorized_by_api_key():
            return "workspace:default"
        return "anonymous"

    def require_auth(self, view: Callable[..., Any]):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if self.current_user() is None and not self.is_request_authorized_by_api_key():
                return jsonify({"error": "unauthorized"}), 401
            return view(*args, **kwargs)

        return wrapped

    def request_headers_snapshot(self) -> dict[str, str]:
        return {
            "user_agent": str(request.headers.get("User-Agent", "")).strip(),
            "content_type": str(request.headers.get("Content-Type", "")).strip(),
            "origin": str(request.headers.get("Origin", "")).strip(),
            "referer": str(request.headers.get("Referer", "")).strip(),
        }
