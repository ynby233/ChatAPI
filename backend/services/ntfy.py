from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from logging import Logger
from urllib import request

from ..core import Settings

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ntfy")


def notify_new_message(
    settings: Settings,
    *,
    conversation_title: str,
    message_text: str,
    logger: Logger,
) -> None:
    url = settings.ntfy_url.strip()
    text = message_text.strip()
    if not url or not text:
        return

    def send() -> None:
        body = text.encode("utf-8")
        req = request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "text/plain; charset=utf-8",
                "Title": conversation_title[:80] or settings.title,
            },
        )
        try:
            with request.urlopen(req, timeout=5) as response:
                response.read(1)
        except Exception:
            logger.exception("Failed to send ntfy notification")

    _executor.submit(send)
