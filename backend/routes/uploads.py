from __future__ import annotations

from pathlib import Path

from flask import Flask, Response, abort, make_response, send_from_directory

from ..core import AppDependencies

EXPIRED_IMAGE_TEXT = "image unavailable"


def _apply_upload_security_headers(response: Response) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self' data:; sandbox"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return response


def register_upload_routes(app: Flask, *, deps: AppDependencies) -> None:
    auth = deps.auth
    image_store = deps.image_store
    user_store = deps.user_store

    @app.get("/api/uploads/imgs/<path:filename>")
    @auth.require_auth
    def get_uploaded_image(filename: str):
        safe_name = Path(filename).name
        if safe_name != filename or not safe_name:
            abort(404)
        if Path(safe_name).suffix.lower() == ".svg":
            abort(404)
        owner_id = user_store.get_uploaded_image_owner(safe_name)
        current_owner = auth.owner_id()
        if not owner_id or owner_id != current_owner:
            abort(404)
        path = image_store.base_dir / safe_name
        if not path.is_file():
            return _apply_upload_security_headers(
                Response(EXPIRED_IMAGE_TEXT, mimetype="text/plain", status=410),
            )
        response = make_response(send_from_directory(image_store.base_dir, safe_name))
        return _apply_upload_security_headers(response)

    @app.get("/api/uploads/imgs/usage")
    @auth.require_admin
    def get_upload_image_usage():
        return {
            "ok": True,
            "usage": image_store.storage_usage(deps.store.iter_messages()),
        }
