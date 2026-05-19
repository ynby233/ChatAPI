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
    def __init__(self, store: Any | None = None):
        self.store = store

    def api_key(self) -> str:
        if self.store is None:
            return ""
        return self.store.get_effective_api_key()

    def totp_secret(self) -> str:
        if self.store is None:
            return ""
        return self.store.get_effective_totp_secret()

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
        current_api_key = self.api_key()
        return bool(current_api_key) and self.request_api_key() == current_api_key

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
