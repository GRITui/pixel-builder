# Internal deployment and shared team library

One container serves the web app and the API; a second serves MCP over HTTP.
Everyone (browsers and agents) works on the same project, stored as one
`ProjectFile` JSON per project id in a data volume.

## Quick start

```bash
cp /dev/null .env
echo "PIXEL_BUILDER_TOKEN=$(openssl rand -hex 32)" >> .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env      # optional: AI buttons only
docker compose up -d --build
curl http://127.0.0.1:8787/healthz               # {"ok":true}
```

Open `http://<host>:8787`. A chip at the bottom-left shows the sync state; its
Settings holds the token and the project id (default `team`).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `AUTH` | `none` | `none` (local dev) or `token`. `proxy-header` is reserved for a future OIDC proxy and refuses to start today. |
| `PIXEL_BUILDER_TOKEN` | - | Required when `AUTH=token`. Callers send `Authorization: Bearer <token>` on `/api/*`. `/healthz` and the static web files stay open. Also the MCP HTTP bearer token and the token the CLI/MCP use to reach a remote workspace. |
| `PIXEL_BUILDER_DATA` | `./pixel-data` (`/data` in Docker) | Where projects are stored (`<id>.json`, atomic writes). |
| `PORT` | `8787` | API + web port. |
| `ANTHROPIC_API_KEY` | - | Enables the AI buttons only. |
| `PIXEL_BUILDER_WORKSPACE` | `./pixel-assets` | Agent side: a directory or `http(s)://host/api/projects/<id>`. |
| `PIXEL_BUILDER_OUT_DIR` | `./pixel-assets` | Agent side with a URL workspace: where PNG exports go (`--out-dir`). |
| `BIND`, `PIXEL_BUILDER_PROJECT`, `MCP_ALLOWED_HOSTS` | `127.0.0.1`, `team`, `localhost,127.0.0.1` | compose only: published interface, project id the MCP service uses, host names accepted by the MCP service. |

## AI provider

`AI_PROVIDER=anthropic` (default, uses `ANTHROPIC_API_KEY` / `PIXEL_MODEL`) or
`openai`: any OpenAI-compatible Chat Completions endpoint.

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai`. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Endpoint root (`/chat/completions` is appended). |
| `OPENAI_API_KEY` | - | Sent as a Bearer token. Optional for local servers when `OPENAI_BASE_URL` is set. |
| `AI_MODEL` | `gpt-4o` | Model for text requests. |
| `AI_VISION_MODEL` | `AI_MODEL` | Model used when reference images are attached. |

Structured output tries `response_format: json_schema`, falls back to
`json_object` (schema in the prompt), then extracts JSON from text; replies are
validated against the schema with one repair retry, and `<think>` blocks are
stripped. `GET /api/health` returns `{enabled, provider, model, vision_model}`
and never the key.

Qwen via DashScope:

```
AI_PROVIDER=openai
OPENAI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
OPENAI_API_KEY=sk-...
AI_MODEL=qwen-max
AI_VISION_MODEL=qwen-vl-max
```

Ollama (local, no key):

```
AI_PROVIDER=openai
OPENAI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3:32b
AI_VISION_MODEL=qwen2.5vl:7b
```

Compose publishes on `127.0.0.1` by default. To expose it to the network set
`BIND=0.0.0.0` and `MCP_ALLOWED_HOSTS=pixel.internal` (your DNS name).

## API

`GET /api/projects` (list), `GET|PUT|DELETE /api/projects/:id`. Ids are slugs
(`a-z 0-9 - _`, up to 64). `GET` returns an `ETag` (content hash); `PUT` with
`If-Match: <etag>` returns `409` when the stored version differs (a `PUT`
without `If-Match` overwrites, which is how a project is created). `GET` honours
`If-None-Match` (304). Bodies up to 64 MB.

The web app saves with the ETag, polls every 5 s so two browsers share one
live library, and shows "changed elsewhere, reload" on a conflict instead of
overwriting. If `/api/projects` is not reachable (plain `npm run dev` without
the server, a static host) it falls back to browser localStorage.

## Security and VPN

Token auth is a shared secret, not user identity. Run it only on a private
network: bind to a VPN interface or put it behind a reverse proxy on the
internal network that terminates TLS (the token travels in a header, so use
HTTPS beyond localhost). Rotate the token by changing `.env` and
`docker compose up -d`; clients then update their stored token. Per-user
identity (OIDC) is not built; the auth seam is `server/auth.ts`.

## Backups: nightly volume snapshot

Each project is one JSON file and writes are atomic, so a plain copy is
consistent:

```bash
# /etc/cron.d/pixel-builder  (03:15 daily, keep 14 days)
15 3 * * * root docker run --rm -v pixel-builder_pixel-data:/data:ro -v /backups/pixel:/out alpine \
  sh -c 'tar czf /out/pixel-data-$(date +\%F).tgz -C /data . && find /out -name "pixel-data-*.tgz" -mtime +14 -delete'
```

Restore: stop the stack, extract into the volume, start again.

## Pointing Claude Code (or any MCP client) at it

Option A, MCP over HTTP (the `mcp` compose service; exports are written on the server in `/exports`):

```bash
claude mcp add --transport http pixel-builder http://pixel.internal:8788/mcp \
  --header "Authorization: Bearer $PIXEL_BUILDER_TOKEN"
```

Option B, a local MCP/CLI process that shares the library but writes PNGs into
your game repo (recommended: files land where the game loads them):

```json
{
  "mcpServers": {
    "pixel-builder": {
      "command": "node",
      "args": ["<ABS>/dist-node/cli.mjs", "mcp",
               "--workspace", "http://pixel.internal:8787/api/projects/team",
               "--out-dir", "<GAME>/pixel-assets"],
      "env": { "PIXEL_BUILDER_TOKEN": "<token>" }
    }
  }
}
```

The CLI works the same: `PIXEL_BUILDER_TOKEN=... pixel-builder --workspace
http://pixel.internal:8787/api/projects/team --out-dir ./pixel-assets list-assets --json`.
If someone else changes the project while a tool runs, the tool fails with a 409
message and overwrites nothing; run it again.

## House kits

`create_kit` with `changes: {"locked": true}` marks a kit as house style:
`update_kit` and the web Kit editor refuse it (fork with `create_kit
base_kit_id=<id>` / Duplicate). Every `update_kit` / Kit editor save bumps the
kit `version`; assets record `kitVersion`, `list_assets` flags `stale` ones and
`rerender_assets stale_only=true` regenerates just those.

## Not built yet

OIDC / per-user identity, per-user quotas and audit log, S3 or database storage
(implement the `Store` interface in `server/store.ts`), cross-process locking
(run one server instance per data volume), merging concurrent edits (conflicts
are detected, not merged).
