from __future__ import annotations

from flask import Flask, request

from ..core import AppDependencies


def register_statistics_routes(app: Flask, *, deps: AppDependencies) -> None:
    auth = deps.auth
    store = deps.store
    user_store = deps.user_store

    @app.get("/api/statistics/summary")
    def get_statistics_summary():
        public_statistics = user_store.get_system_config("public_statistics", "0") == "1"
        if not public_statistics and auth.current_user() is None and auth.resolve_owner_from_api_key() is None:
            return {"error": "unauthorized"}, 401

        owner = auth.owner_id()
        start_at = request.args.get("start") or None
        end_at = request.args.get("end") or None
        summary = store.get_statistics_summary(owner, start_at=start_at, end_at=end_at)
        return {
            "ok": True,
            "summary": summary,
        }
