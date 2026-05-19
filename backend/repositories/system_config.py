from __future__ import annotations

import secrets
import sqlite3
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any


class SystemConfigStore:
    _DOMAIN_PATTERN = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    @contextmanager
    def _connection(self):
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL DEFAULT ''
                )
                """
            )

    def get_system_config(self, key: str, default: str = "") -> str:
        with self._connection() as conn:
            row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
        if row is None:
            return default
        return str(row["value"] or "")

    def set_system_config(self, key: str, value: str) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO config (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def get_system_config_flag(self, key: str, default: bool = False) -> bool:
        return self.get_system_config(key, "1" if default else "0") == "1"

    def _normalize_registration_email_domains(self, raw: str) -> str:
        domains: list[str] = []
        for item in raw.replace("\n", ",").split(","):
            domain = item.strip().lower()
            if not domain:
                continue
            if domain.startswith("@"):
                domain = domain[1:]
            if not self._DOMAIN_PATTERN.fullmatch(domain):
                raise ValueError(f"无效的邮箱域名：{domain}")
            domains.append(domain)
        return ",".join(dict.fromkeys(domains))

    def get_registration_email_domains(self) -> list[str]:
        raw = self.get_system_config("value.registration_email_domains", "")
        if not raw.strip():
            return []
        return [item for item in self._normalize_registration_email_domains(raw).split(",") if item]

    def is_registration_email_allowed(self, email: str) -> bool:
        if not self.get_system_config_flag("flag.registration_email_domain_restriction", False):
            return True
        domains = set(self.get_registration_email_domains())
        if not domains or "@" not in email:
            return False
        _, domain = email.rsplit("@", 1)
        return domain.strip().lower() in domains

    def get_system_config_snapshot(self) -> dict[str, Any]:
        return {
            "public_statistics": self.get_system_config_flag("public_statistics", False),
            "title_enabled": self.get_system_config_flag("flag.title", False),
            "title": self.get_system_config("value.title", ""),
            "external_registration_enabled": self.get_system_config_flag(
                "flag.external_registration",
                False,
            ),
            "email_verification_enabled": self.get_system_config_flag(
                "flag.email_verification",
                False,
            ),
            "email_provider": self.get_system_config("value.email_provider", ""),
            "registration_email_domain_restriction_enabled": self.get_system_config_flag(
                "flag.registration_email_domain_restriction",
                False,
            ),
            "registration_email_domains": self.get_system_config("value.registration_email_domains", ""),
        }

    def update_system_config_snapshot(self, data: dict[str, Any]) -> None:
        registration_email_domain_restriction_enabled = bool(
            data.get("registration_email_domain_restriction_enabled"),
        )
        if registration_email_domain_restriction_enabled:
            registration_email_domains = self._normalize_registration_email_domains(
                str(data.get("registration_email_domains", "")),
            )
        else:
            registration_email_domains = ""
        self.set_system_config(
            "public_statistics",
            "1" if bool(data.get("public_statistics")) else "0",
        )
        self.set_system_config(
            "flag.title",
            "1" if bool(data.get("title_enabled")) else "0",
        )
        self.set_system_config("value.title", str(data.get("title", "")))
        self.set_system_config(
            "flag.external_registration",
            "1" if bool(data.get("external_registration_enabled")) else "0",
        )
        self.set_system_config(
            "flag.email_verification",
            "1" if bool(data.get("email_verification_enabled")) else "0",
        )
        self.set_system_config("value.email_provider", str(data.get("email_provider", "")))
        self.set_system_config(
            "flag.registration_email_domain_restriction",
            "1" if registration_email_domain_restriction_enabled else "0",
        )
        self.set_system_config(
            "value.registration_email_domains",
            registration_email_domains,
        )

    def get_effective_title(self, fallback: str = "") -> str:
        if not self.get_system_config_flag("flag.title", False):
            return fallback
        value = self.get_system_config("value.title", "").strip()
        return value or fallback

    def get_or_create_session_secret(self, fallback_secret: str = "") -> str:
        if fallback_secret.strip() == "change-this-session-secret":
            fallback_secret = ""
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT value FROM config WHERE key = ?",
                ("system.session_secret",),
            ).fetchone()
            if row is not None:
                current = str(row["value"] or "")
                if current:
                    return current

            value = fallback_secret or secrets.token_urlsafe(48)
            conn.execute(
                """
                INSERT INTO config (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                ("system.session_secret", value),
            )
            return value
