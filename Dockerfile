# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHATAPI_HOST=0.0.0.0 \
    CHATAPI_PORT=5000 \
    CHATAPI_DATA_DIR=/data \
    CHATAPI_DB_PATH=/data/chatapi.sqlite3 \
    CHATAPI_WEB_DIST_DIR=/app/frontend/dist

WORKDIR /app
RUN pip install --no-cache-dir uv

COPY backend/pyproject.toml backend/uv.lock backend/README.md ./backend/
WORKDIR /app/backend
RUN uv sync --frozen --no-dev

WORKDIR /app
COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 5000

WORKDIR /app/backend
CMD ["/app/backend/.venv/bin/python", "main.py"]
