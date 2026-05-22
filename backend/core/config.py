from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            values[key] = value
    return values


def _load_env_files() -> None:
    candidates = [
        _repo_root() / ".env",
        _repo_root() / "backend" / ".env",
    ]
    external_env_file = os.environ.get("CHATAPI_ENV_FILE", "").strip()
    if external_env_file:
        candidates.append(Path(external_env_file).expanduser())
    merged: dict[str, str] = {}
    for candidate in candidates:
        merged.update(_parse_env_file(candidate))
    for key, value in merged.items():
        os.environ.setdefault(key, value)


_load_env_files()


def _first_non_empty(*keys: str, default: str = "") -> str:
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return default


def _split_csv(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    admin_username: str
    admin_password: str
    session_secret: str
    data_dir: Path
    db_path: Path
    uploads_img_dir: Path
    cors_origins: list[str]
    host: str
    port: int
    debug: bool
    tls_cert_file: Path | None
    tls_key_file: Path | None
    web_dist_dir: Path | None
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    email_from: str
    smtp_use_tls: bool
    resend_api_key: str
    brevo_api_key: str
    brevo_from_name: str
    tencentcloud_secret_id: str
    tencentcloud_secret_key: str
    tencentcloud_ses_region: str
    tencentcloud_template_id: str
    geetest_captcha_id: str
    geetest_captcha_key: str
    geetest_api_server: str

    @classmethod
    def from_env(cls) -> "Settings":
        repo_root = _repo_root()
        data_dir = Path(_first_non_empty("CHATAPI_DATA_DIR", "DATA_DIR", default=str(repo_root / "data")))
        if not data_dir.is_absolute():
            data_dir = (repo_root / data_dir).resolve()
        db_path = Path(_first_non_empty("CHATAPI_DB_PATH", default=str(data_dir / "chatapi.sqlite3")))
        if not db_path.is_absolute():
            db_path = (repo_root / db_path).resolve()
        uploads_img_dir = data_dir / "uploads" / "imgs"
        cors_raw = _first_non_empty(
            "CHATAPI_CORS_ORIGINS",
            "CORS_ORIGINS",
            default="http://localhost:5173,http://127.0.0.1:5173",
        )
        tls_cert_raw = _first_non_empty(
            "CHATAPI_TLS_CERT_FILE",
            "TLS_CERT_FILE",
            default="",
        )
        tls_key_raw = _first_non_empty(
            "CHATAPI_TLS_KEY_FILE",
            "TLS_KEY_FILE",
            default="",
        )
        web_dist_raw = _first_non_empty(
            "CHATAPI_WEB_DIST_DIR",
            "WEB_DIST_DIR",
            default="",
        )

        def _resolve_optional_path(raw: str) -> Path | None:
            if not raw:
                return None
            path = Path(raw)
            if not path.is_absolute():
                path = (repo_root / path).resolve()
            return path

        return cls(
            admin_username=_first_non_empty("CHATAPI_ADMIN_USERNAME", "CHATAPI_USERNAME", "ADMIN_USERNAME", default="admin"),
            admin_password=_first_non_empty("CHATAPI_ADMIN_PASSWORD", "CHATAPI_PASSWORD", "ADMIN_PASSWORD", default="change-me"),
            session_secret=_first_non_empty(
                "CHATAPI_SESSION_SECRET",
                "ADMIN_SESSION_SECRET",
                default="",
            ),
            data_dir=data_dir,
            db_path=db_path,
            uploads_img_dir=uploads_img_dir,
            cors_origins=_split_csv(cors_raw),
            host=_first_non_empty("CHATAPI_HOST", "BACKEND_HOST", default="0.0.0.0"),
            port=int(_first_non_empty("CHATAPI_PORT", "BACKEND_PORT", default="5000")),
            debug=_first_non_empty("CHATAPI_DEBUG", "FLASK_DEBUG", default="0") == "1",
            tls_cert_file=_resolve_optional_path(tls_cert_raw),
            tls_key_file=_resolve_optional_path(tls_key_raw),
            web_dist_dir=_resolve_optional_path(web_dist_raw),
            smtp_host=_first_non_empty("CHATAPI_SMTP_HOST", "SMTP_HOST", default=""),
            smtp_port=int(_first_non_empty("CHATAPI_SMTP_PORT", "SMTP_PORT", default="587")),
            smtp_username=_first_non_empty("CHATAPI_SMTP_USERNAME", "SMTP_USERNAME", default=""),
            smtp_password=_first_non_empty("CHATAPI_SMTP_PASSWORD", "SMTP_PASSWORD", default=""),
            email_from=_first_non_empty("CHATAPI_EMAIL_FROM", default=""),
            smtp_use_tls=_first_non_empty("CHATAPI_SMTP_USE_TLS", "SMTP_USE_TLS", default="1") == "1",
            resend_api_key=_first_non_empty("CHATAPI_RESEND_API_KEY", "RESEND_API_KEY", default=""),
            brevo_api_key=_first_non_empty("CHATAPI_BREVO_API_KEY", "BREVO_API_KEY", default=""),
            brevo_from_name=_first_non_empty("CHATAPI_BREVO_FROM_NAME", "BREVO_FROM_NAME", default="ChatAPI"),
            tencentcloud_secret_id=_first_non_empty(
                "CHATAPI_TENCENTCLOUD_SECRET_ID",
                "TENCENTCLOUD_SECRET_ID",
                default="",
            ),
            tencentcloud_secret_key=_first_non_empty(
                "CHATAPI_TENCENTCLOUD_SECRET_KEY",
                "TENCENTCLOUD_SECRET_KEY",
                default="",
            ),
            tencentcloud_ses_region=_first_non_empty(
                "CHATAPI_TENCENTCLOUD_SES_REGION",
                "TENCENTCLOUD_SES_REGION",
                default="ap-guangzhou",
            ),
            tencentcloud_template_id=_first_non_empty(
                "CHATAPI_TENCENTCLOUD_TEMPLATE_ID",
                "TENCENTCLOUD_TEMPLATE_ID",
                default="",
            ),
            geetest_captcha_id=_first_non_empty("CHATAPI_GEETEST_CAPTCHA_ID", "GEETEST_CAPTCHA_ID", default=""),
            geetest_captcha_key=_first_non_empty("CHATAPI_GEETEST_CAPTCHA_KEY", "GEETEST_CAPTCHA_KEY", default=""),
            geetest_api_server=_first_non_empty("CHATAPI_GEETEST_API_SERVER", "GEETEST_API_SERVER", default="http://gcaptcha4.geetest.com"),
        )


settings = Settings.from_env()
