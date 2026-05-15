from __future__ import annotations

from dataclasses import dataclass

from .auth import AuthContext
from .config import Settings
from ..repositories import ConversationStore
from ..services import AssistantService, MessageRateLimiter, PendingTurnRegistry


@dataclass(frozen=True)
class AppDependencies:
    settings: Settings
    auth: AuthContext
    store: ConversationStore
    assistant: AssistantService
    pending_turns: PendingTurnRegistry
    message_rate_limiter: MessageRateLimiter
