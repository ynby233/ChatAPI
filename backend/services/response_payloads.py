from __future__ import annotations

import time
import uuid
import json
from typing import Any


def _estimate_tokens(text: str) -> int:
    text = text.strip()
    if not text:
        return 0
    ascii_tokens = len(text.split())
    cjk_chars = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    return max(ascii_tokens, 1) + cjk_chars // 2


def estimate_usage(input_text: str, output_text: str) -> dict[str, int]:
    input_tokens = _estimate_tokens(input_text)
    output_tokens = _estimate_tokens(output_text)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }


def build_openai_response(
    *,
    response_id: str,
    model: str,
    conversation_id: str,
    assistant_text: str,
    usage: dict[str, int] | None,
    status: str = "completed",
    output_items: list[dict[str, Any]] | None = None,
    output_text: str | None = None,
) -> dict[str, Any]:
    created_at = int(time.time())
    message_id = f"msg_{uuid.uuid4().hex[:24]}"
    normalized_output_items = output_items
    if normalized_output_items is None:
        normalized_output_text = assistant_text if output_text is None else output_text
        normalized_output_items = [
            {
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": normalized_output_text,
                    }
                ],
            }
        ]
    else:
        normalized_output_text = assistant_text if output_text is None else output_text
    return {
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": status,
        "model": model,
        "conversation_id": conversation_id,
        "output": normalized_output_items,
        "output_text": normalized_output_text,
        "usage": usage,
    }


def build_openai_error(message: str, code: str = "bad_request", status: int = 400) -> tuple[dict[str, Any], int]:
    return (
        {
            "error": {
                "message": message,
                "type": code,
                "code": code,
            }
        },
        status,
    )


def parse_json_object(text: str) -> Any:
    try:
        return json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return text


def build_chat_completion_response(
    *,
    response_id: str,
    model: str,
    assistant_text: str,
    usage: dict[str, int] | None,
    response_mode: str = "assistant_message",
    tool_name: str = "",
    tool_call_id: str = "",
    arguments: str = "",
) -> dict[str, Any]:
    finish_reason = "stop"
    message: dict[str, Any] = {
        "role": "assistant",
        "content": assistant_text,
    }
    if response_mode == "tool_call":
        finish_reason = "tool_calls"
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": tool_call_id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": arguments,
                    },
                }
            ],
        }
    return {
        "id": response_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": usage["input_tokens"] if usage else 0,
            "completion_tokens": usage["output_tokens"] if usage else 0,
            "total_tokens": usage["total_tokens"] if usage else 0,
        },
    }


def build_anthropic_message_response(
    *,
    response_id: str,
    model: str,
    assistant_text: str,
    usage: dict[str, int] | None,
    response_mode: str = "assistant_message",
    tool_name: str = "",
    tool_call_id: str = "",
    arguments: str = "",
) -> dict[str, Any]:
    stop_reason = "end_turn"
    content: list[dict[str, Any]]
    if response_mode == "tool_call":
        stop_reason = "tool_use"
        content = [
            {
                "type": "tool_use",
                "id": tool_call_id,
                "name": tool_name,
                "input": parse_json_object(arguments),
            }
        ]
    else:
        content = [{"type": "text", "text": assistant_text}]
    return {
        "id": response_id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage["input_tokens"] if usage else 0,
            "output_tokens": usage["output_tokens"] if usage else 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
    }
