
# ChatAPI

Flask + Ant Design chat app with:

- session login from `.env`
- conversation sidebar with mobile Drawer support
- OpenAI Responses-style API at `POST /v1/responses`
- one request maps to one conversation item by default, while `conversation_id` or tool result `call_id` can continue an existing conversation

## Quick start

1. Copy the env template:

```bash
cp .env.example .env
```

2. Edit `.env` and set at least:

- `CHATAPI_USERNAME`
- `CHATAPI_PASSWORD`
- `CHATAPI_SESSION_SECRET`

Optional:

- `CHATAPI_NTFY_URL` to push each newly received user message to an ntfy topic
- `CHATAPI_MESSAGES_PER_MINUTE_LIMIT` to limit how many user messages the backend accepts per minute; `0` disables the limit

3. Run the backend:

```bash
cd backend
python main.py
```

4. Run the frontend:

```bash
cd frontend
npm run dev
```

If you want to serve the app under a subpath such as `/chatapi/`, set `VITE_APP_BASE_PATH` before building the frontend:

```bash
cd frontend
VITE_APP_BASE_PATH=/chatapi/ npm run build
```

With that setting, frontend assets load from `/chatapi/` and frontend API requests go to `/chatapi/api/...` and `/chatapi/v1/...`.

## API

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/conversations`
- `GET /api/conversations/<id>/messages`
- `POST /api/conversations`
- `POST /api/conversations/<id>/rename`
- `POST /v1/responses`

The `responses` endpoint accepts a compact OpenAI-style payload:

```json
{
  "model": "hutao",
  "input": "你是一只猫娘"
}
```

If `conversation_id` is omitted, the backend normally creates a new conversation. The exception is a tool result request carrying `function_call_output.call_id`: it will be routed back to the conversation that produced that tool call.

## ntfy notification

If `.env` contains `CHATAPI_NTFY_URL`, the backend will `POST` the latest received user message text to that ntfy URL after the message is accepted and persisted.
