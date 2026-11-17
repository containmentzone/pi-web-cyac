# pi-web-cyac

A pi package that adds a web UI to the [pi coding agent](https://github.com/earendil-works/pi), styled with the CyAc design system. Install it into pi, type `/web`, and open the URL.

- **Runs inside pi.** The `/web` command starts an HTTP + WebSocket server in your pi process. It uses your installed pi (the package declares pi as a peer dependency) and your existing `~/.pi/agent` config, providers and extensions.
- **Threads are pi sessions.** There is no database. Threads are pi's own JSONL session files under `~/.pi/agent/sessions`, so a web thread can be resumed with `pi --resume`, and CLI sessions show up in the web list. Each open thread is its own live `AgentSession`; runs keep going when the tab closes.
- **One WebSocket per tab.** The server forwards pi's session events (deltas only, like pi's RPC mode). On subscribe it sends a snapshot first, so reloads, reconnects and a second tab all pick up mid-stream.
- **Extension UI works.** `ctx.ui.select/confirm/input/editor` show up as cards in the thread. Pending dialogs are held on the server, so they survive a reload, appear in every open tab, and the first answer wins. `notify`, `setStatus`, `setWidget`, `setTitle` and `setEditorText` map to notices, status-bar readings, panels above the composer, the thread header and the composer. TUI-only calls (`custom()`, footers, headers, themes) behave as they do in pi's RPC mode.

There is no authentication. Bind it to loopback or to a Tailscale address, not to a public interface.

## Install

The package is published to GitHub Packages, which needs a token even for installs. Create a GitHub token with `read:packages`, then add this to `~/.npmrc`:

```
@containmentzone:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

Then:

```sh
pi install npm:@containmentzone/pi-web-cyac
```

## Use

Inside pi:

```
/web                    start on 127.0.0.1:8787
/web 100.x.y.z:8787     start on your Tailscale address
/web 9000               another port on loopback
/web stop               stop it
```

The command prints the URL. The server lives as long as that pi process. To start it without typing the command, set `PI_WEB_AUTOSTART=1` (for example `PI_WEB_AUTOSTART=1 PI_WEB_HOST=100.x.y.z pi` in a tmux pane on the box).

### Settings

`/web host:port` wins over these; the rest only come from the environment.

| Variable | Default | |
| --- | --- | --- |
| `PI_WEB_HOST` | `127.0.0.1` | Bind address |
| `PI_WEB_PORT` | `8787` | |
| `PI_WEB_AUTOSTART` | off | Start the server when pi loads the extension |
| `PI_WEB_CWD` | pi's working directory | Default working directory for new threads |
| `PI_WEB_SESSION_DIR` | pi's default | Keep web threads in their own session folder |
| `PI_WEB_STATE_FILE` | `~/.pi/agent/pi-web/threads.json` | UI-only state (archived flags) |
| `PI_WEB_IDLE_MINUTES` | `30` | Idle, unwatched sessions are unloaded and reopen from disk on demand |

## Develop

```sh
npm ci
npm run dev      # server with reload on :8787 (standalone, no pi TUI) + Vite on :5173
npm run build
pi -e .          # load this checkout into pi, then /web
```

`npm start` (or the `pi-web` bin) runs the same server standalone, without a pi TUI.

## Releasing

The Package workflow typechecks and builds every push. On the default branch it publishes to GitHub Packages whenever `version` in `package.json` is not published yet, so bumping the version is the release.

## Layout

```
server/        extension.ts (the /web command), app.ts (Hono + ws server), thread manager, live sessions, ctx.ui bridge, cli.ts (standalone)
shared/        WebSocket protocol types shared by both halves
web/           React 18 + Vite frontend
web/src/cyac/  Vendored CyAc bundle, CSS, types and tokens (tokens.css is generated: npm run gen:tokens)
```

## Known limits

- A thread should be driven from one place at a time. If you open the session your pi terminal is using in the web UI too, both append to the same file.
- Extension commands that open a new session (`newSession`, `fork`, `switchSession`) open it as a new thread and focus it, instead of replacing the current one. `session_before_switch`/`session_before_fork` hooks are not run for these.
- No branching UI, image upload, file browser or provider login in the browser yet.

## Fonts

ModeNine (`web/public/fonts`) is freely distributable on the condition that its readme travels with it; it does.
