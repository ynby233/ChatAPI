import gc
gc.set_threshold(300,5,3)

from pathlib import Path
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app import create_app
from backend.core import settings


def main() -> None:
    app = create_app()
    ssl_context: tuple[str, str] | None = None
    if settings.tls_cert_file or settings.tls_key_file:
        if not settings.tls_cert_file or not settings.tls_key_file:
            raise RuntimeError(
                "CHATAPI_TLS_CERT_FILE and CHATAPI_TLS_KEY_FILE must be set together"
            )
        if not settings.tls_cert_file.exists():
            raise FileNotFoundError(
                f"TLS certificate file not found: {settings.tls_cert_file}"
            )
        if not settings.tls_key_file.exists():
            raise FileNotFoundError(
                f"TLS key file not found: {settings.tls_key_file}"
            )
        ssl_context = (
            str(settings.tls_cert_file),
            str(settings.tls_key_file),
        )
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug,
        ssl_context=ssl_context,
    )


if __name__ == "__main__":
    main()
