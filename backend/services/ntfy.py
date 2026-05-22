from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from email.header import Header
from logging import Logger
from urllib import request

from ..repositories import SystemConfigStore, UserStore

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ntfy")


def _encode_header(value: str) -> str:
    try:
        value.encode("latin-1")
        return value
    except UnicodeEncodeError:
        return Header(value, "utf-8").encode()


def notify_new_message(
    system_config_store: SystemConfigStore,
    user_store: UserStore,
    owner_id: str,
    *,
    conversation_title: str,
    message_text: str,
    logger: Logger,
) -> None:
    url = user_store.get_effective_ntfy_url(owner_id)
    text = message_text.strip()
    if not url or not text:
        return
    title_fallback = system_config_store.get_effective_title("ChatAPI")

    def send() -> None:
        body = text.encode("utf-8")
        req = request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "text/plain; charset=utf-8",
                "Title": _encode_header(conversation_title[:80] or title_fallback),
            },
        )
        try:
            with request.urlopen(req, timeout=5) as response:
                response.read(1)
        except Exception:
            logger.exception("Failed to send ntfy notification")

    _executor.submit(send)
