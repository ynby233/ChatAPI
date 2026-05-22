# Docker / FNOS deployment

This fork publishes a single-container image to GitHub Container Registry:

```text
ghcr.io/ynby233/chatapi:latest
```

## Container settings

Recommended FNOS/container panel settings:

- Image: `ghcr.io/ynby233/chatapi:latest`
- Container port: `5000`
- Host port: any free local port, for example `5000`
- Volume: mount a persistent NAS directory to `/data`

The image serves both the Flask API and the built frontend from the same port.
Use Lucky or another reverse proxy to expose the host port through HTTPS.

## Required environment variables

Set these in the container panel:

```env
CHATAPI_USERNAME=admin
CHATAPI_PASSWORD=change-me
```

Recommended optional values:

```env
CHATAPI_SESSION_SECRET=replace-with-a-long-random-string
CHATAPI_CORS_ORIGINS=https://your-domain.example
```

The image already sets these defaults:

```env
CHATAPI_HOST=0.0.0.0
CHATAPI_PORT=5000
CHATAPI_DATA_DIR=/data
CHATAPI_DB_PATH=/data/chatapi.sqlite3
CHATAPI_WEB_DIST_DIR=/app/frontend/dist
```

Do not configure TLS certificate files inside the container if Lucky handles HTTPS.

## Updates

GitHub Actions checks the upstream project on schedule and publishes a fresh image when it builds successfully. In FNOS, pull `ghcr.io/ynby233/chatapi:latest` again and recreate/restart the container when you want to update.
