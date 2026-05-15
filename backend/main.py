from pathlib import Path
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app import create_app
from backend.core import settings


def main() -> None:
    app = create_app()
    app.run(host=settings.host, port=settings.port, debug=True)


if __name__ == "__main__":
    main()
