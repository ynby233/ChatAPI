from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from ..repositories import SystemConfigStore
from ..repositories.users import UserStore


_DATA_IMAGE_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.IGNORECASE | re.DOTALL)
_UPLOAD_URL_RE = re.compile(r"/api/uploads/imgs/([A-Za-z0-9._-]+)(?:\?.*)?$", re.IGNORECASE)
ALLOWED_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "image/tiff",
}


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _mime_to_extension(mime_type: str) -> str:
    normalized = mime_type.lower().split(";", 1)[0].strip()
    mapping = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/avif": "avif",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
    }
    return mapping.get(normalized, normalized.rsplit("/", 1)[-1] or "img")


def _mime_from_magic(image_bytes: bytes) -> str | None:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    if image_bytes.startswith(b"BM"):
        return "image/bmp"
    if image_bytes.startswith(b"\x00\x00\x00") and b"ftypavif" in image_bytes[:32]:
        return "image/avif"
    if image_bytes.lstrip().startswith(b"<?xml") or b"<svg" in image_bytes[:256].lower():
        return None
    return None


def _is_image_key(key: str) -> bool:
    normalized = _normalize_key(key)
    return any(token in normalized for token in ("image", "img", "photo", "picture", "thumbnail", "avatar", "filedata", "basedata", "binary"))


def _looks_like_base64(value: str) -> bool:
    candidate = re.sub(r"\s+", "", value)
    if len(candidate) < 32 or len(candidate) % 4 != 0:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9+/=]+", candidate))


def _try_parse_structured_content(raw: str) -> Any | None:
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        pass

    trimmed = raw.strip()
    if not trimmed or trimmed[0] not in "[{":
        return None

    normalized = ""
    in_single_quote = False
    in_double_quote = False
    escape_next = False

    for char in trimmed:
        if escape_next:
            normalized += char
            escape_next = False
            continue
        if char == "\\":
            normalized += char
            escape_next = True
            continue
        if char == "'" and not in_double_quote:
            normalized += '"'
            in_single_quote = not in_single_quote
            continue
        if char == '"' and not in_single_quote:
            normalized += char
            in_double_quote = not in_double_quote
            continue
        normalized += '\\"' if in_single_quote and char == '"' else char

    normalized = normalized.replace("None", "null").replace("True", "true").replace("False", "false")
    try:
        return json.loads(normalized)
    except (TypeError, json.JSONDecodeError):
        return None


def _decode_base64_image(value: str, *, mime_type_hint: str | None = None) -> tuple[bytes, str] | None:
    text = value.strip()
    data_url_match = _DATA_IMAGE_RE.match(text)
    if data_url_match:
        mime_type = data_url_match.group(1)
        payload = data_url_match.group(2)
    else:
        if not _looks_like_base64(text):
            return None
        mime_type = mime_type_hint or ""
        payload = text
    try:
        image_bytes = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None
    detected_mime = _mime_from_magic(image_bytes)
    if detected_mime is not None:
        mime_type = detected_mime
    if not mime_type.startswith("image/"):
        return None
    return image_bytes, mime_type


class ImageAssetStore:
    def __init__(
        self,
        base_dir: Path,
        route_prefix: str = "/api/uploads/imgs",
        system_config_store: SystemConfigStore | None = None,
        user_store: UserStore | None = None,
    ):
        self.base_dir = base_dir
        self.route_prefix = route_prefix.rstrip("/")
        self.system_config_store = system_config_store
        self.user_store = user_store
        self._request_bytes = 0
        self.base_dir.mkdir(parents=True, exist_ok=True)

    @property
    def route_root(self) -> str:
        return self.route_prefix

    def public_url(self, filename: str) -> str:
        return f"{self.route_root}/{filename}"

    def _filename_for(self, image_bytes: bytes, mime_type: str) -> str:
        digest = hashlib.sha256(image_bytes).hexdigest()
        ext = _mime_to_extension(mime_type)
        return f"{digest}.{ext}"

    def _config_int(self, key: str, default: int = 0) -> int:
        if self.system_config_store is None:
            return default
        try:
            return max(0, int(self.system_config_store.get_system_config(key, str(default)) or default))
        except ValueError:
            return default

    def _placeholder_for_expired(self, filename: str) -> str:
        return f"{self.route_root}/{filename}"

    def _can_store(self, image_bytes: bytes) -> bool:
        size = len(image_bytes)
        single_limit = self._config_int("value.image_max_single_bytes", 0)
        if single_limit > 0 and size > single_limit:
            return False

        request_limit = self._config_int("value.image_max_request_bytes", 0)
        if request_limit > 0 and self._request_bytes + size > request_limit:
            return False

        total_limit = self._config_int("value.image_max_total_bytes", 0)
        if total_limit > 0:
            self.prune_oldest_to_fit(max(0, total_limit - size))
            if self.storage_usage()["total_bytes"] + size > total_limit:
                return False
        return True

    def _track_owner(self, filename: str, owner_id: str | None, mime_type: str) -> None:
        if self.user_store is None or not owner_id:
            return
        self.user_store.set_uploaded_image_owner(filename, owner_id, mime_type)

    def store_data_url(self, value: str, *, owner_id: str | None = None) -> str | None:
        decoded = _decode_base64_image(value)
        if decoded is None:
            return None
        image_bytes, mime_type = decoded
        if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
            return None
        filename = self._filename_for(image_bytes, mime_type)
        if not self._can_store(image_bytes):
            return self._placeholder_for_expired(filename)
        path = self.base_dir / filename
        if not path.exists():
            path.write_bytes(image_bytes)
        self._track_owner(filename, owner_id, mime_type)
        self._request_bytes += len(image_bytes)
        return self.public_url(filename)

    def normalize_request_data(self, value: Any, *, owner_id: str | None = None) -> Any:
        self._request_bytes = 0
        return self._normalize_node(value, owner_id=owner_id)

    def _rewrite_string(self, value: str, *, key: str = "", owner_id: str | None = None) -> str:
        data_url_url = self.store_data_url(value, owner_id=owner_id)
        if data_url_url is not None:
            return data_url_url

        decoded = _decode_base64_image(value)
        if decoded is not None:
            image_bytes, mime_type = decoded
            if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
                return value
            filename = self._filename_for(image_bytes, mime_type)
            if not self._can_store(image_bytes):
                return self._placeholder_for_expired(filename)
            path = self.base_dir / filename
            if not path.exists():
                path.write_bytes(image_bytes)
            self._track_owner(filename, owner_id, mime_type)
            self._request_bytes += len(image_bytes)
            return self.public_url(filename)

        if _is_image_key(key):
            decoded = _decode_base64_image(value)
            if decoded is not None:
                image_bytes, mime_type = decoded
                if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
                    return value
                filename = self._filename_for(image_bytes, mime_type)
                if not self._can_store(image_bytes):
                    return self._placeholder_for_expired(filename)
                path = self.base_dir / filename
                if not path.exists():
                    path.write_bytes(image_bytes)
                self._track_owner(filename, owner_id, mime_type)
                self._request_bytes += len(image_bytes)
                return self.public_url(filename)
        return value

    def _normalize_node(self, value: Any, *, key: str = "", owner_id: str | None = None) -> Any:
        if isinstance(value, str):
            parsed = _try_parse_structured_content(value)
            if parsed is not None:
                return self._normalize_node(parsed, key=key, owner_id=owner_id)
            return self._rewrite_string(value, key=key, owner_id=owner_id)
        if isinstance(value, list):
            return [self._normalize_node(item, key=key, owner_id=owner_id) for item in value]
        if isinstance(value, dict):
            rewritten: dict[str, Any] = {}
            for item_key, item_value in value.items():
                rewritten[item_key] = self._normalize_node(item_value, key=str(item_key), owner_id=owner_id)
            return rewritten
        return value

    def rewrite_value(self, value: Any, *, key: str = "", owner_id: str | None = None) -> Any:
        return self._normalize_node(value, key=key, owner_id=owner_id)

    def normalize_content(self, content: Any, *, owner_id: str | None = None) -> str:
        if isinstance(content, str):
            parsed = _try_parse_structured_content(content)
            if parsed is not None:
                rewritten = self.rewrite_value(parsed, key="content", owner_id=owner_id)
                return json.dumps(rewritten, ensure_ascii=False, separators=(",", ":"))
        rewritten = self.rewrite_value(content, key="content", owner_id=owner_id)
        if isinstance(rewritten, str):
            return rewritten.replace("\r\n", "\n").replace("\\r\\n", "\n").replace("\\n", "\n")
        return json.dumps(rewritten, ensure_ascii=False, separators=(",", ":"))

    def backfill_owners_from_messages(self, messages: list[Any], owner_lookup: dict[str, str]) -> None:
        if self.user_store is None:
            return
        for message in messages:
            owner_id = owner_lookup.get(str(getattr(message, "conversation_id", "")).strip(), "")
            if not owner_id:
                continue
            for match in _UPLOAD_URL_RE.finditer(str(getattr(message, "content", "") or "")):
                filename = match.group(1)
                if filename:
                    mime_type = ""
                    suffix = Path(filename).suffix.lower()
                    if suffix == ".png":
                        mime_type = "image/png"
                    elif suffix in {".jpg", ".jpeg"}:
                        mime_type = "image/jpeg"
                    elif suffix == ".gif":
                        mime_type = "image/gif"
                    elif suffix == ".webp":
                        mime_type = "image/webp"
                    elif suffix == ".avif":
                        mime_type = "image/avif"
                    elif suffix == ".bmp":
                        mime_type = "image/bmp"
                    elif suffix in {".tif", ".tiff"}:
                        mime_type = "image/tiff"
                    self.user_store.set_uploaded_image_owner(filename, owner_id, mime_type)

    def referenced_filenames(self, content: str) -> set[str]:
        if not content:
            return set()
        pattern = re.compile(
            rf"(?:https?://[^\s\"']+)?{re.escape(self.route_root)}/([A-Za-z0-9._-]+)",
            re.IGNORECASE,
        )
        return {match.group(1) for match in pattern.finditer(content)}

    def cleanup_orphans(self, messages: list[Any]) -> list[str]:
        referenced: set[str] = set()
        for message in messages:
            content = getattr(message, "content", "")
            if isinstance(content, str):
                referenced.update(self.referenced_filenames(content))

        deleted: list[str] = []
        if not self.base_dir.exists():
            return deleted

        for path in self.base_dir.iterdir():
            if not path.is_file():
                continue
            if path.name in referenced:
                continue
            path.unlink(missing_ok=True)
            deleted.append(path.name)
        return deleted

    def storage_usage(self, messages: list[Any] | None = None) -> dict[str, int]:
        total_bytes = 0
        file_count = 0
        orphan_bytes = 0
        referenced: set[str] | None = None
        if messages is not None:
            referenced = set()
            for message in messages:
                content = getattr(message, "content", "")
                if isinstance(content, str):
                    referenced.update(self.referenced_filenames(content))

        if not self.base_dir.exists():
            return {
                "total_bytes": 0,
                "file_count": 0,
                "orphan_bytes": 0,
                "orphan_count": 0,
            }

        orphan_count = 0
        for path in self.base_dir.iterdir():
            if not path.is_file():
                continue
            size = path.stat().st_size
            total_bytes += size
            file_count += 1
            if referenced is not None and path.name not in referenced:
                orphan_bytes += size
                orphan_count += 1

        return {
            "total_bytes": total_bytes,
            "file_count": file_count,
            "orphan_bytes": orphan_bytes,
            "orphan_count": orphan_count,
        }

    def prune_oldest_to_fit(self, target_bytes: int) -> list[str]:
        target_bytes = max(0, int(target_bytes))
        files = [
            path
            for path in self.base_dir.iterdir()
            if path.is_file()
        ] if self.base_dir.exists() else []
        total = sum(path.stat().st_size for path in files)
        if total <= target_bytes:
            return []

        deleted: list[str] = []
        for path in sorted(files, key=lambda item: item.stat().st_mtime):
            if total <= target_bytes:
                break
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            total -= size
            deleted.append(path.name)
        return deleted
