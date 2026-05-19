from __future__ import annotations

from flask import Flask, abort, send_from_directory
from flask_cors import CORS

from .core import AppDependencies, AuthContext, settings
from .repositories import ConversationStore
from .services import ImageAssetStore, MessageRateLimiter, PendingTurnRegistry
from .services.realtime import RealtimeBroker
from .routes import (
    register_auth_routes,
    register_conversation_routes,
    register_realtime_routes,
    register_response_routes,
    register_statistics_routes,
    register_upload_routes,
)


def create_app() -> Flask:
    store = ConversationStore(settings.db_path)
    session_secret = store.get_or_create_session_secret(settings.session_secret)

    app = Flask(__name__)
    app.config.update(SECRET_KEY=session_secret)
    CORS(app, supports_credentials=True, origins=settings.cors_origins)

    auth = AuthContext(store)
    pending_turns = PendingTurnRegistry()
    message_rate_limiter = MessageRateLimiter(limit=store.get_effective_messages_per_minute_limit(0))
    image_store = ImageAssetStore(settings.uploads_img_dir)
    realtime = RealtimeBroker(store)
    deps = AppDependencies(
        settings=settings,
        auth=auth,
        store=store,
        pending_turns=pending_turns,
        message_rate_limiter=message_rate_limiter,
        image_store=image_store,
    )
    app.extensions["chat_store"] = store
    app.extensions["chat_realtime"] = realtime
    app.extensions["chat_image_store"] = image_store

    image_store.cleanup_orphans(store.iter_messages())

    @app.get("/api/health")
    def health():
        return {"ok": True, "title": store.get_effective_title("ChatAPI")}

    register_auth_routes(app, auth=auth, settings=settings)
    register_conversation_routes(app, deps=deps)
    register_realtime_routes(app, deps=deps)
    register_response_routes(app, deps=deps)
    register_statistics_routes(app, deps=deps)
    register_upload_routes(app, deps=deps)

    if settings.web_dist_dir:
        web_dist_dir = settings.web_dist_dir
        index_file = web_dist_dir / "index.html"
        if not web_dist_dir.exists():
            raise FileNotFoundError(f"WEB_DIST_DIR not found: {web_dist_dir}")
        if not web_dist_dir.is_dir():
            raise NotADirectoryError(f"WEB_DIST_DIR is not a directory: {web_dist_dir}")

        def _send_dist_file(request_path: str):
            candidate = (web_dist_dir / request_path).resolve()
            try:
                candidate.relative_to(web_dist_dir.resolve())
            except ValueError as exc:
                raise FileNotFoundError(request_path) from exc
            if candidate.is_file():
                relative_path = candidate.relative_to(web_dist_dir).as_posix()
                return send_from_directory(web_dist_dir, relative_path)
            raise FileNotFoundError(request_path)

        @app.get("/", defaults={"request_path": ""})
        @app.get("/<path:request_path>")
        def serve_web_dist(request_path: str):
            if request_path.startswith("api/") or request_path.startswith("v1/"):
                abort(404)
            if not request_path:
                if not index_file.exists():
                    abort(404)
                return send_from_directory(web_dist_dir, "index.html")
            try:
                return _send_dist_file(request_path)
            except FileNotFoundError:
                if index_file.exists():
                    return send_from_directory(web_dist_dir, "index.html")
                abort(404)

    return app
