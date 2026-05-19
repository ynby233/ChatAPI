from __future__ import annotations

from flask import Flask, jsonify, request

from ..core import AppDependencies
from ..services.response_stream import (
    client_disconnected,
    discard_pending_turn,
    stream_anthropic_turn,
    stream_chat_completion_turn,
    stream_pending_turn,
)
from ..services.turn_coordinator import PreparedTurn, TurnCoordinator


def register_response_routes(app: Flask, *, deps: AppDependencies) -> None:
    auth = deps.auth
    store = deps.store
    user_store = deps.user_store
    realtime = app.extensions.get("chat_realtime")

    def publish_sync(owner_id: str, conversation_id: str | None = None) -> None:
        if realtime is None or not conversation_id:
            return
        realtime.publish_conversation_upsert(owner_id, conversation_id)

    coordinator = TurnCoordinator(
        deps,
        extensions=app.extensions,
        logger=app.logger,
        publish_sync=publish_sync,
    )

    def handle_protocol_request(data: dict[str, object], request_format: str):
        prepared = coordinator.prepare_pending_turn(data, request_format)
        if isinstance(prepared, tuple):
            body, status = prepared
            return jsonify(body), status

        assert isinstance(prepared, PreparedTurn)
        pending = prepared.pending
        if bool(data.get("stream")):
            stream_kwargs = {
                "pending": pending,
                "pending_turns": deps.pending_turns,
                "store": deps.store,
                "build_abort_error": coordinator.build_abort_error,
                "client_socket": request.environ.get("werkzeug.socket"),
                "publish_sync": publish_sync,
            }
            if request_format == "chat_completions":
                return stream_chat_completion_turn(**stream_kwargs)
            if request_format == "anthropic_messages":
                return stream_anthropic_turn(**stream_kwargs)
            return stream_pending_turn(**stream_kwargs)

        client_socket = request.environ.get("werkzeug.socket")
        while True:
            if pending.event.is_set():
                waited = deps.pending_turns.wait(pending.request_id)
                if waited.aborted:
                    body, status = coordinator.build_abort_error(
                        waited.abort_message or "request aborted"
                    )
                    return jsonify(body), status
                return jsonify(coordinator.finalize_pending_turn(waited))
            if client_disconnected(client_socket):
                discard_pending_turn(
                    pending,
                    pending_turns=deps.pending_turns,
                    store=deps.store,
                    publish_sync=publish_sync,
                )
                body, status = coordinator.build_not_found_error(
                    "client disconnected",
                    code="client_disconnected",
                    status=499,
                )
                return jsonify(body), status
            pending.event.wait(0.5)

    @app.post("/responses")
    @app.post("/v1/responses")
    @auth.require_auth
    def responses():
        data = request.get_json(silent=True) or {}
        return handle_protocol_request(data, "responses")

    @app.post("/chat/completions")
    @app.post("/v1/chat/completions")
    @auth.require_auth
    def chat_completions():
        data = request.get_json(silent=True) or {}
        return handle_protocol_request(data, "chat_completions")

    @app.post("/messages")
    @app.post("/v1/messages")
    @auth.require_auth
    def anthropic_messages():
        data = request.get_json(silent=True) or {}
        return handle_protocol_request(data, "anthropic_messages")

    @app.post("/api/chat/output/complete")
    @auth.require_auth
    def chat_output_complete():
        result = coordinator.complete_manual_output(request.get_json(silent=True) or {})
        if isinstance(result, tuple):
            body, status = result
            return jsonify(body), status
        return jsonify(result)

    @app.post("/api/chat/output/delta")
    @auth.require_auth
    def chat_output_delta():
        result = coordinator.add_manual_output_delta(request.get_json(silent=True) or {})
        if isinstance(result, tuple):
            body, status = result
            return jsonify(body), status
        return jsonify(result)

    @app.get("/api/config/stream-heartbeat")
    @auth.require_auth
    def get_stream_heartbeat_config():
        owner_id = auth.owner_id()
        return {"ok": True, **coordinator.get_stream_heartbeat_settings(owner_id)}

    @app.post("/api/config/stream-heartbeat")
    @auth.require_auth
    def update_stream_heartbeat_config():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return {"error": "request body must be a JSON object"}, 400

        owner_id = auth.owner_id()
        heartbeat_text = str(data.get("heartbeat_text", ""))
        raw_interval = data.get("heartbeat_interval_seconds", 0)
        try:
            interval_seconds = float(raw_interval or 0)
        except (TypeError, ValueError):
            return {"error": "heartbeat_interval_seconds must be a number"}, 400
        if interval_seconds < 0:
            return {"error": "heartbeat_interval_seconds must be greater than or equal to 0"}, 400

        return {
            "ok": True,
            **coordinator.update_stream_heartbeat_settings(
                owner_id,
                heartbeat_text=heartbeat_text,
                heartbeat_interval_seconds=interval_seconds,
            ),
        }

    @app.get("/api/config/automation-rules")
    @auth.require_auth
    def get_automation_rules():
        owner_id = auth.owner_id()
        return {"ok": True, "rules": coordinator.get_automation_rules(owner_id)}

    @app.post("/api/config/automation-rules")
    @auth.require_auth
    def update_automation_rules():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return {"error": "request body must be a JSON object"}, 400
        rules = data.get("rules", [])
        if not isinstance(rules, list):
            return {"error": "rules must be an array"}, 400
        owner_id = auth.owner_id()
        try:
            normalized = coordinator.update_automation_rules(owner_id, rules)
        except ValueError as error:
            return {"error": str(error)}, 400
        return {"ok": True, "rules": normalized}

    @app.get("/api/config/system")
    @auth.require_auth
    @auth.require_admin
    def get_system_config():
        return {
            "ok": True,
            **user_store.get_system_config_snapshot(),
        }

    @app.post("/api/config/system")
    @auth.require_auth
    @auth.require_admin
    def update_system_config():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return {"error": "request body must be a JSON object"}, 400

        try:
            user_store.update_system_config_snapshot(data)
        except ValueError as error:
            return {"error": str(error)}, 400

        return {
            "ok": True,
            **user_store.get_system_config_snapshot(),
        }

    @app.get("/api/config/app-info")
    @auth.require_auth
    def get_app_info():
        return {
            "ok": True,
        }
