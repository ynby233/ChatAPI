from __future__ import annotations

import sqlite3
import uuid
from typing import Any

from .models import Conversation, build_title, json_dump, json_load, utc_now_iso


class ConversationCrudMixin:
    def create_conversation(
        self,
        owner_id: str,
        title: str = "新会话",
        last_user_text: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> Conversation:
        now = utc_now_iso()
        conversation = Conversation(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            title=title or "新会话",
            last_user_text=last_user_text,
            created_at=now,
            updated_at=now,
            last_message_at=now,
            metadata=metadata or {},
            message_count=0,
            last_message_preview="",
        )
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO conversations
                (id, owner_id, title, last_user_text, metadata, created_at, updated_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation.id,
                    conversation.owner_id,
                    conversation.title,
                    conversation.last_user_text,
                    json_dump(conversation.metadata),
                    conversation.created_at,
                    conversation.updated_at,
                    conversation.last_message_at,
                ),
            )
        return conversation

    def get_conversation(self, conversation_id: str, owner_id: str) -> Conversation | None:
        with self._connection() as conn:
            row = conn.execute(
                """
                SELECT
                    c.*,
                    COUNT(m.id) AS message_count,
                    COALESCE((
                        SELECT substr(m2.content, 1, 120)
                        FROM messages m2
                        WHERE m2.conversation_id = c.id
                        ORDER BY datetime(m2.created_at) DESC
                        LIMIT 1
                    ), '') AS last_message_preview
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.id
                WHERE c.id = ? AND c.owner_id = ?
                GROUP BY c.id
                """,
                (conversation_id, owner_id),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_conversation(row)

    def list_conversations(self, owner_id: str) -> list[Conversation]:
        with self._connection() as conn:
            rows = conn.execute(
                """
                SELECT
                    c.*,
                    COUNT(m.id) AS message_count,
                    COALESCE((
                        SELECT substr(m2.content, 1, 120)
                        FROM messages m2
                        WHERE m2.conversation_id = c.id
                        ORDER BY datetime(m2.created_at) DESC
                        LIMIT 1
                    ), '') AS last_message_preview
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.id
                WHERE c.owner_id = ?
                GROUP BY c.id
                ORDER BY datetime(c.updated_at) DESC
                """,
                (owner_id,),
            ).fetchall()
        return [self._row_to_conversation(row) for row in rows]

    def list_conversations_all(self) -> list[Conversation]:
        with self._connection() as conn:
            rows = conn.execute(
                """
                SELECT
                    c.*,
                    COUNT(m.id) AS message_count,
                    COALESCE((
                        SELECT substr(m2.content, 1, 120)
                        FROM messages m2
                        WHERE m2.conversation_id = c.id
                        ORDER BY datetime(m2.created_at) DESC
                        LIMIT 1
                    ), '') AS last_message_preview
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.id
                GROUP BY c.id
                ORDER BY datetime(c.updated_at) DESC
                """
            ).fetchall()
        return [self._row_to_conversation(row) for row in rows]

    def delete_conversation(self, conversation_id: str, owner_id: str) -> None:
        if self.get_conversation(conversation_id, owner_id) is None:
            raise ValueError("conversation not found")
        with self._connection() as conn:
            conn.execute(
                """
                DELETE FROM messages
                WHERE conversation_id = ?
                """,
                (conversation_id,),
            )
            conn.execute(
                """
                DELETE FROM conversations
                WHERE id = ? AND owner_id = ?
                """,
                (conversation_id, owner_id),
            )

    def delete_conversations_except_latest(
        self,
        owner_id: str,
        keep_count: int,
    ) -> tuple[list[str], int]:
        keep_count = max(0, int(keep_count))
        conversations = self.list_conversations(owner_id)
        stale_conversations = conversations[keep_count:]
        deletable_ids = [
            item.id
            for item in stale_conversations
            if item.metadata.get("realtime_status") != "waiting"
        ]
        skipped_count = len(stale_conversations) - len(deletable_ids)

        if not deletable_ids:
            return [], skipped_count

        placeholders = ", ".join("?" for _ in deletable_ids)
        with self._connection() as conn:
            conn.execute(
                f"""
                DELETE FROM messages
                WHERE conversation_id IN ({placeholders})
                """,
                deletable_ids,
            )
            conn.execute(
                f"""
                DELETE FROM conversations
                WHERE owner_id = ? AND id IN ({placeholders})
                """,
                (owner_id, *deletable_ids),
            )
        return deletable_ids, skipped_count

    def delete_owner_conversations(self, owner_id: str) -> list[str]:
        conversations = self.list_conversations(owner_id)
        conversation_ids = [item.id for item in conversations]
        if not conversation_ids:
            return []

        placeholders = ", ".join("?" for _ in conversation_ids)
        with self._connection() as conn:
            conn.execute(
                f"""
                DELETE FROM messages
                WHERE conversation_id IN ({placeholders})
                """,
                conversation_ids,
            )
            conn.execute(
                f"""
                DELETE FROM conversations
                WHERE owner_id = ? AND id IN ({placeholders})
                """,
                (owner_id, *conversation_ids),
            )
        return conversation_ids

    def update_conversation(
        self,
        conversation_id: str,
        owner_id: str,
        *,
        title: str | None = None,
        last_user_text: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Conversation:
        current = self.get_conversation(conversation_id, owner_id)
        if current is None:
            raise ValueError("conversation not found")
        new_title = title if title is not None else current.title
        new_last_user_text = last_user_text if last_user_text is not None else current.last_user_text
        new_metadata = metadata if metadata is not None else current.metadata
        with self._connection() as conn:
            conn.execute(
                """
                UPDATE conversations
                SET title = ?, last_user_text = ?, metadata = ?, updated_at = ?
                WHERE id = ? AND owner_id = ?
                """,
                (
                    new_title,
                    new_last_user_text,
                    json_dump(new_metadata),
                    utc_now_iso(),
                    conversation_id,
                    owner_id,
                ),
            )
        refreshed = self.get_conversation(conversation_id, owner_id)
        if refreshed is None:
            raise ValueError("conversation not found")
        return refreshed

    def record_assistant_reply(
        self,
        conversation_id: str,
        owner_id: str,
        user_text: str,
        assistant_text: str,
        response_id: str,
        assistant_metadata: dict[str, Any] | None = None,
    ) -> Conversation:
        if self.get_conversation(conversation_id, owner_id) is None:
            raise ValueError("conversation not found")
        self.add_message(
            conversation_id,
            "assistant",
            assistant_text,
            response_id=response_id,
            metadata=assistant_metadata or {},
        )
        current = self.get_conversation(conversation_id, owner_id)
        if current is None:
            raise ValueError("conversation not found")
        if current.title in {"新会话", "New conversation", ""}:
            self.update_conversation(
                conversation_id,
                owner_id,
                title=build_title(user_text),
                last_user_text=user_text[:1000],
            )
        else:
            self.update_conversation(
                conversation_id,
                owner_id,
                last_user_text=user_text[:1000],
            )
        refreshed = self.get_conversation(conversation_id, owner_id)
        if refreshed is None:
            raise ValueError("conversation not found")
        return refreshed

    @staticmethod
    def _row_to_conversation(row: sqlite3.Row) -> Conversation:
        return Conversation(
            id=str(row["id"]),
            owner_id=str(row["owner_id"]),
            title=str(row["title"]),
            last_user_text=str(row["last_user_text"] or ""),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            last_message_at=str(row["last_message_at"]),
            metadata=json_load(row["metadata"], {}),
            message_count=int(row["message_count"] or 0),
            last_message_preview=str(row["last_message_preview"] or ""),
        )
