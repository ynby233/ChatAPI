# ChatAPI 部署说明

本项目是一个让 各类 AI 客户端用 OpenAI Responses 风格接口调用人类的项目，并带有一个 Web 控制台界面，可以帮你组装 Tool Calling 请求。  
你可以让别人把你配置到 Agent 或 聊天机器人中，然后自己扮演 AI 助手被调用。

- 后端：Flask
- 前端：React + Vite + Ant Design
- 数据存储：SQLite

默认提供：

- 基于 `.env` 的用户名密码登录，支持可选 TOTP
- 支持 `/v1/chat/completions`、`/v1/responses`、`/messages` 三套接口
- 会话列表与消息持久化能力，便于调试和查看上下文
- 自动化回复输出能力，支持定时流式发送、循环输出，条件判断自动回复等场景
- 可选 ntfy 消息推送

## 1. 部署
### 无需 Nginx 一键部署
#### 构建前端

```bash
cd ./frontend
npm i
npm run build
```

#### 设置.env
```env
CHATAPI_USERNAME=用户名
CHATAPI_PASSWORD=密码
# 可选；如果不填，后端会在首次启动时自动生成并写入数据库配置表
# CHATAPI_SESSION_SECRET=随机字符串

CHATAPI_DB_PATH=./data/chatapi.sqlite3
CHATAPI_DATA_DIR=./data

CHATAPI_HOST=0.0.0.0
CHATAPI_PORT=443
CHATAPI_WEB_DIST_DIR=../frontend/dist
CHATAPI_TLS_CERT_FILE=../certs/server.crt
CHATAPI_TLS_KEY_FILE=../certs/server.key
```

#### 启动Flask

```bash
cd ./backend
uv sync
uv run main.py
```
### dev部署

#### 后动后端

```bash
cd ./backend
uv sync
uv run main.py
```

#### 启动前端

```bash
cd ./frontend
npm i
npm run dev
```

## 3. 配置环境变量

先复制配置模板：

```bash
cp .env.example .env
```

至少需要修改以下配置：

```env
CHATAPI_USERNAME=admin
CHATAPI_PASSWORD=change-me
# 可选；如果不填，后端会在首次启动时自动生成并写入数据库配置表
# CHATAPI_SESSION_SECRET=change-this-session-secret
```

建议同时确认以下配置：

```env
CHATAPI_DB_PATH=./data/chatapi.sqlite3
CHATAPI_DATA_DIR=./data
CHATAPI_HOST=0.0.0.0
CHATAPI_PORT=5000
CHATAPI_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

登录后可以在「系统设置」里启用并保存 `API Key`、站点标题、ntfy 地址、消息限流和 TOTP，这些不再需要放在 `.env` 里。

可选配置：

```env
# 直接让 Flask 对外托管前端静态文件（例如 Vite build 后的 dist）
# CHATAPI_WEB_DIST_DIR=./frontend/dist

# 直接由 Flask 提供 HTTPS 时使用
# CHATAPI_TLS_CERT_FILE=./certs/server.crt
# CHATAPI_TLS_KEY_FILE=./certs/server.key
```

## 4. Nginx 反向代理示例

以下示例假设：

- 前端静态文件目录：`/path/to/ChatAPI/frontend/dist`
- 后端地址：`http://127.0.0.1:5000`
- 域名：`chat.example.com`

```nginx
server {
    listen 80;
    server_name chat.example.com;

    root /path/to/ChatAPI/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:5000/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果要启用 HTTPS，建议由 Nginx 处理证书，而不是直接使用 Flask 内置服务。

如果不想额外部署 Nginx，也可以直接让 Flask 对外同时提供 API 和前端静态文件：

```env
CHATAPI_WEB_DIST_DIR=./frontend/dist
```

设置后：

- `/api/*` 和 `/v1/*` 继续走后端接口
- 其他路径会从该目录下直接返回静态文件
- 当请求路径不存在且目录中包含 `index.html` 时，会自动回退到 `index.html`，可用于前端单页应用路由


## 5. 可用接口

后端默认提供以下接口：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/health`
- `GET /api/conversations`
- `GET /api/conversations/<id>/messages`
- `POST /api/conversations`
- `POST /api/conversations/<id>/rename`
- `POST /v1/responses`
- `POST /v1/chat/completions`
- `POST /messages`

核心接口是 `/v1/responses`，接受 OpenAI Responses 风格请求，例如：  
调用示例：  

```bash
curl https://127.0.0.1:5000/v1/responses \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-i-love-you-hutao' \
  -d '{
    "model": "胡桃酱",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "在这里打字就可以和胡桃酱本人对话！"
          }
        ]
      }
    ],
    "stream": true
  }'

```

Anthropic Messages 兼容接口使用 `/messages`，例如：

```bash
curl https://127.0.0.1:5000/messages \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-i-love-you-hutao' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "你好"
      }
    ],
    "stream": true
  }'
```

---

## 6. 项目结构

```
ChatAPI/
├── backend/                    # Python/Flask backend
│   ├── core/                   # Core config, auth, dependencies
│   ├── routes/                 # Flask route handlers
│   ├── services/               # Business logic (streaming, turn coordination, etc.)
│   ├── repositories/           # SQLite data access layer
│   ├── .env                    # Live environment config (gitignored)
│   ├── .env.example            # Environment template
│   ├── app.py                  # Flask app factory
│   ├── main.py                 # Entry point (runs Flask dev server)
│   └── pyproject.toml          # Python dependencies (uv)
├── frontend/                   # React/Vite frontend
│   ├── src/
│   │   ├── components/         # UI components
│   │   ├── hooks/              # Custom React hooks
│   │   ├── lib/                # Utility functions
│   │   ├── types/              # TypeScript type definitions
│   │   ├── theme/              # Theme provider
│   │   └── assets/             # Static assets
│   ├── homepage.html           # Standalone landing page (rendered in iframe)
│   ├── vite.config.ts          # Vite build config
│   └── package.json            # Node dependencies
├── certs/                      # TLS certificates (gitignored)
├── data/                       # SQLite database storage (gitignored)
├── tests/                      # Test files
├── deploy_rsync.sh             # Deployment script
└── README.md                   # Project documentation
```

### Backend 核心文件

| 文件 | 用途 |
|---|---|
| `backend/main.py` | 入口，启动 Flask 服务 |
| `backend/app.py` | Flask app factory，路由注册，静态文件托管 |
| `backend/core/config.py` | Settings dataclass，从 `.env` 加载配置 |
| `backend/core/auth.py` | Session + API key 认证，TOTP 验证 |
| `backend/core/dependencies.py` | AppDependencies 依赖注入 |
| `backend/routes/auth.py` | 登录/登出/会话接口 |
| `backend/routes/conversations.py` | 会话 CRUD、裁剪、中止 |
| `backend/routes/responses.py` | `/v1/responses`、`/v1/chat/completions`、`/messages` 接口 |
| `backend/routes/realtime.py` | WebSocket 实时更新 |
| `backend/routes/statistics.py` | 统计/摘要接口 |
| `backend/services/turn_coordinator.py` | Human-in-the-loop 轮次协调 |
| `backend/services/realtime.py` | WebSocket pub/sub broker |
| `backend/services/pending.py` | 等待中的轮次注册 |
| `backend/services/output_controller.py` | Assistant 输出控制 |
| `backend/services/response_stream.py` | 流式响应总入口 |
| `backend/services/stream_responses.py` | OpenAI Responses 格式流式输出 |
| `backend/services/stream_chat_completions.py` | Chat Completions 格式流式输出 |
| `backend/services/stream_anthropic.py` | Anthropic Messages 格式流式输出 |
| `backend/services/stream_common.py` | 流式输出公共工具 |
| `backend/services/turn_protocols.py` | 请求解析/格式标准化 |
| `backend/services/payload_openai.py` | OpenAI Responses 格式响应构建 |
| `backend/services/payload_chat_completions.py` | Chat Completions 格式响应构建 |
| `backend/services/payload_anthropic.py` | Anthropic Messages 格式响应构建 |
| `backend/services/response_payloads.py` | 共享响应 payload 工具 |
| `backend/services/automation_rules.py` | 自动化规则引擎 |
| `backend/services/rate_limit.py` | 用户级消息速率限制 |
| `backend/services/ntfy.py` | ntfy 推送通知集成 |
| `backend/repositories/conversations.py` | SQLite 数据访问层 |

### Frontend 核心文件

| 文件 | 用途 |
|---|---|
| `frontend/src/main.tsx` | React 入口，BrowserRouter，ThemeProvider |
| `frontend/src/App.tsx` | 顶层路由 (`/`, `/login`, `/app/*`, `/stat`) |
| `frontend/src/components/WorkspaceRoute.tsx` | 主工作区布局（侧边栏 + 聊天面板） |
| `frontend/src/components/ChatPane.tsx` | 聊天消息展示、输入框、Tool Call 表单 |
| `frontend/src/components/ConversationSidebar.tsx` | 会话列表、设置、自动化规则编辑 |
| `frontend/src/components/LoginScreen.tsx` | 登录表单（含可选 TOTP） |
| `frontend/src/components/HomepageScreen.tsx` | 首页（iframe 加载 homepage.html） |
| `frontend/src/components/StatisticsPage.tsx` | 独立统计页面 |
| `frontend/src/hooks/useChatWorkspace.ts` | 主工作区状态管理（WebSocket、会话、消息） |
| `frontend/src/hooks/useAuthSession.ts` | 认证会话管理 |
| `frontend/src/lib/api.ts` | HTTP/WebSocket 请求工具函数 |
| `frontend/src/lib/chat-format.tsx` | 消息渲染、JSON 格式化、Schema 解析 |
| `frontend/src/types/chat.ts` | TypeScript 类型定义 |
| `frontend/src/theme/ThemeProvider.tsx` | Ant Design 主题提供者 |
