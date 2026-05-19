from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import struct
import time
from functools import wraps
from typing import Any, Callable

from flask import jsonify, request, session


class AuthContext:
    def __init__(self, store: Any | None = None, user_store: Any | None = None):
        self.store = store
        self.user_store = user_store

    def current_user(self) -> dict[str, str] | None:
        user_id = str(session.get("user_id", "") or "").strip()
        username = str(session.get("username", "") or "").strip()
        role = str(session.get("role", "") or "").strip()
        if user_id and username:
            return {"id": user_id, "username": username, "role": role}
        return None

    def request_api_key(self) -> str:
        return str(
            request.headers.get("Authorization", "").removeprefix("Bearer ")
            or request.headers.get("X-API-Key", "")
            or ""
        ).strip()

    def resolve_owner_from_api_key(self) -> str | None:
        api_key = self.request_api_key()
        if not api_key or self.user_store is None:
            return None
        return self.user_store.resolve_api_key_owner(api_key)

    def owner_id(self) -> str:
        user = self.current_user()
        if user:
            return user["id"]
        owner = self.resolve_owner_from_api_key()
        if owner:
            return owner
        return "anonymous"

    def is_admin(self) -> bool:
        user = self.current_user()
        return user is not None and user.get("role") == "admin"

    def require_auth(self, view: Callable[..., Any]):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if self.current_user() is None and self.resolve_owner_from_api_key() is None:
                return jsonify({"error": "unauthorized"}), 401
            return view(*args, **kwargs)
        return wrapped

    def require_admin(self, view: Callable[..., Any]):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not self.is_admin():
                return jsonify({"error": "forbidden"}), 403
            return view(*args, **kwargs)
        return wrapped

    def request_headers_snapshot(self) -> dict[str, str]:
        return {
            "user_agent": str(request.headers.get("User-Agent", "")).strip(),
            "content_type": str(request.headers.get("Content-Type", "")).strip(),
            "origin": str(request.headers.get("Origin", "")).strip(),
            "referer": str(request.headers.get("Referer", "")).strip(),
        }


def _normalize_totp_secret(secret: str) -> bytes:
    normalized = "".join(secret.split()).upper()
    if not normalized:
        return b""
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    try:
        return base64.b32decode(f"{normalized}{padding}", casefold=True)
    except (binascii.Error, ValueError):
        return secret.encode("utf-8")


def _totp_code(secret: bytes, counter: int, digits: int = 6) -> str:
    digest = hmac.new(secret, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**digits)).zfill(digits)


def generate_totp_secret() -> str:
    raw = base64.b32encode(hashlib.sha256(time.time_ns().to_bytes(16, "big")).digest()[:20]).decode()
    return raw.rstrip("=")


def build_totp_uri(secret: str, username: str, issuer: str = "ChatAPI") -> str:
    import urllib.parse
    label = urllib.parse.quote(f"{issuer}:{username}")
    issuer_encoded = urllib.parse.quote(issuer)
    return f"otpauth://totp/{label}?secret={secret}&issuer={issuer_encoded}&algorithm=SHA1&digits=6&period=30"


def verify_totp_code(
    secret: str,
    code: str,
    *,
    for_time: int | None = None,
    step: int = 30,
    window: int = 1,
    digits: int = 6,
) -> bool:
    secret_bytes = _normalize_totp_secret(secret)
    if not secret_bytes:
        return False

    candidate = "".join(str(code).split())
    if not candidate.isdigit() or len(candidate) != digits:
        return False

    now = int(time.time() if for_time is None else for_time)
    counter = now // step
    for drift in range(-window, window + 1):
        if hmac.compare_digest(_totp_code(secret_bytes, counter + drift, digits=digits), candidate):
            return True
    return False
