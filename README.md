# pi-web-cyac

A small web UI for the [pi coding agent](https://github.com/earendil-works/pi), styled with the CyAc design system.

- **pi runs in process.** A Node server embeds pi through its SDK (`@earendil-works/pi-coding-agent`, pinned to an exact version) and keeps one live `AgentSession` per thread. Sessions keep running when the tab closes.
- **Threads are pi sessions.** There is no database. Threads are pi's own JSONL session files under `~/.pi/agent/sessions`, so a web thread can also be resumed with `pi --resume` in a terminal, and CLI sessions show up in the web list.
- **One WebSocket per tab.** The server forwards pi's session events (deltas only, like pi's RPC mode). On subscribe it sends a snapshot first, so reloads, reconnects and a second tab all pick up mid-stream.
- **Extension UI works.** `ctx.ui.select/confirm/input/editor` show up as cards in the thread. Pending dialogs are held on the server, so they survive a reload, appear in every open tab, and the first answer wins. `notify`, `setStatus`, `setWidget`, `setTitle` and `setEditorText` are mapped to notices, status-bar readings, panels above the composer, the thread header and the composer. TUI-only calls (`custom()`, footers, headers, themes) behave as they do in pi's RPC mode.

There is no authentication. It is meant to run behind a firewall, for example on a Tailscale address.

## Run it

pi needs to be configured once (providers, API keys or `/login`) the normal way, with the `pi` CLI. The server reuses `~/.pi/agent`.

```sh
npm ci
npm run build
PI_WEB_HOST=100.x.y.z npm start     # your Tailscale IP; defaults to 127.0.0.1
```

For development, `npm run dev` runs the server with reload on :8787 and Vite on :5173 (proxying `/api` and `/ws`).

### Container

The image is published to GitHub Packages as `ghcr.io/containmentzone/pi-web-cyac`.

```sh
docker run -d --name pi-web \
  -p 100.x.y.z:8787:8787 \
  -v pi-agent:/home/node/.pi \
  -v /srv/code:/workspace \
  ghcr.io/containmentzone/pi-web-cyac:latest
```

- `/home/node/.pi` holds pi's config, credentials and the session files. Mount your existing `~/.pi` to share threads with the CLI on the host (the container runs as uid 1000).
- `/workspace` is the default working directory for new threads. The agent's bash tool runs inside the container, which ships git, ripgrep, curl, jq and openssh-client.
- Publish the port on your Tailscale IP only, as above.

To configure pi inside a fresh volume: `docker exec -it pi-web npx pi` and use `/login`, or copy in `auth.json` / `models.json`.

### Settings

| Variable | Default | |
| --- | --- | --- |
| `PI_WEB_HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Bind address |
| `PI_WEB_PORT` | `8787` | |
| `PI_WEB_CWD` | process cwd (`/workspace` in the image) | Default working directory for new threads |
| `PI_WEB_SESSION_DIR` | pi's default | Keep web threads in their own session folder |
| `PI_WEB_STATE_FILE` | `~/.pi/agent/pi-web/threads.json` | UI-only state (archived flags) |
| `PI_WEB_IDLE_MINUTES` | `30` | Idle, unwatched sessions are unloaded and reopen from disk on demand |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi's own config dir override |

## Layout

```
server/        Node server: Hono + ws, thread manager, live sessions, ctx.ui bridge
shared/        WebSocket protocol types shared by both halves
web/           React 18 + Vite frontend
web/src/cyac/  Vendored CyAc bundle, CSS, types and tokens (tokens.css is generated: npm run gen:tokens)
```

## Known limits

- A thread should be driven from one place at a time. The CLI and the web UI both append to the same session file if you open it in both.
- Extension commands that open a new session (`newSession`, `fork`, `switchSession`) open it as a new thread and focus it, instead of replacing the current one. `session_before_switch`/`session_before_fork` hooks are not run for these.
- No branching UI, image upload, file browser or provider login in the browser yet.

## Fonts

ModeNine (`web/public/fonts`) is freely distributable on the condition that its readme travels with it; it does.
