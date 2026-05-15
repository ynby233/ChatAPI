from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any

from ..core import Settings


def _estimate_tokens(text: str) -> int:
    text = text.strip()
    if not text:
        return 0
    ascii_tokens = len(text.split())
    cjk_chars = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    return max(ascii_tokens, 1) + cjk_chars // 2


def _extract_text_from_input(input_payload: Any) -> str:
    parts: list[str] = []

    def visit(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, str):
            parts.append(node)
            return
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if isinstance(node, dict):
            if "text" in node and isinstance(node["text"], str):
                parts.append(node["text"])
                return
            if "content" in node:
                visit(node["content"])
                return
            if node.get("role") in {"user", "assistant", "system", "developer"}:
                visit(node.get("content"))
                return
            for value in node.values():
                visit(value)

    visit(input_payload)
    return "\n".join(part.strip() for part in parts if str(part).strip()).strip()


def _build_local_reply(conversation_title: str, user_text: str, previous_summary: str) -> str:
    cleaned = user_text.strip()
    if not cleaned:
        return "我已收到请求，但没有提取到可回答的正文。"
    lead = cleaned[:180]
    if previous_summary.strip():
        return (
            f"我已经把这条消息接入「{conversation_title}」会话。\n"
            f"当前我看到的上下文是：{previous_summary[:180].strip()}\n"
            f"本轮输入：{lead}"
        )
    return (
        f"我已经把这条消息接入「{conversation_title}」会话。\n"
        f"本轮输入：{lead}"
    )


@dataclass
class AssistantResult:
    text: str
    model: str
    provider: str
    usage: dict[str, int]
    raw: dict[str, Any] | None = None


class AssistantService:
    def __init__(self, settings: Settings):
        self.settings = settings

    def generate(
        self,
        *,
        model: str | None,
        input_payload: Any,
        conversation_title: str,
        previous_summary: str,
    ) -> AssistantResult:
        user_text = _extract_text_from_input(input_payload)
        if self.settings.upstream_responses_url and self.settings.upstream_api_key:
            upstream = self._call_upstream(
                model=model or self.settings.upstream_model,
                input_payload=input_payload,
            )
            if upstream is not None:
                text = upstream.get("output_text") or self._extract_output_text(upstream)
                if text:
                    return AssistantResult(
                        text=text,
                        model=str(upstream.get("model") or model or self.settings.upstream_model),
                        provider="upstream",
                        usage=self._usage_from_texts(user_text, text),
                        raw=upstream,
                    )
        reply = _build_local_reply(conversation_title, user_text, previous_summary)
        return AssistantResult(
            text=reply,
            model=model or "local-fallback",
            provider="local",
            usage=self._usage_from_texts(user_text, reply),
        )

    def _call_upstream(self, *, model: str, input_payload: Any) -> dict[str, Any] | None:
        payload = {
            "model": model,
            "input": input_payload,
        }
        request = urllib.request.Request(
            self.settings.upstream_responses_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.settings.upstream_api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read().decode("utf-8", "replace")
            return json.loads(raw)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, ValueError):
            return None

    @staticmethod
    def _extract_output_text(payload: dict[str, Any]) -> str:
        parts: list[str] = []
        for item in payload.get("output", []) or []:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        parts.append(part["text"])
        return "\n".join(parts).strip()

    @staticmethod
    def _usage_from_texts(input_text: str, output_text: str) -> dict[str, int]:
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
