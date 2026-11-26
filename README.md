# pi-web-cyac

A pi package that adds a web UI to the [pi coding agent](https://github.com/earendil-works/pi), styled with the CyAc design system. Install it into pi, type `/web`, and open the URL.

- **Runs inside pi.** The `/web` command starts an HTTP + WebSocket server in your pi process. It uses your installed pi (the package declares pi as a peer dependency) and your existing `~/.pi/agent` config, providers and extensions.
- **Threads are pi sessions.** There is no database. Threads are pi's own JSONL session files under `~/.pi/agent/sessions`, so a web thread can be resumed with `pi --resume`, and CLI sessions show up in the web list. Each open thread is its own live `AgentSession`; runs keep going when the tab closes.
- **One WebSocket per tab.** The server forwards pi's session events (deltas only, like pi's RPC mode). On subscribe it sends a snapshot first, so reloads, reconnects and a second tab all pick up mid-stream.
- **One composer at a time.** Every tab and every person looking at a thread sees the same live state. Typing claims the thread's composer for that tab, and the composer is locked in other tabs until it sends, clears its text, leaves the thread, or goes 30 seconds without typing.
- **Extension UI works.** `ctx.ui.select/confirm/input/editor` show up as cards in the thread. Pending dialogs are held on the server, so they survive a reload, appear in every open tab, and the first answer wins. `notify`, `setStatus`, `setWidget`, `setTitle` and `setEditorText` map to notices, status-bar readings, panels above the composer, the thread header and the composer. `ctx.ui.custom()` components run on the server and are mirrored into a terminal panel in the thread, with keys sent back; footers, headers and themes behave as they do in pi's RPC mode.
- **Slash commands like pi's.** Typing `/` lists every command (built-ins, prompt templates, extension commands, skills) with its help text; after `/name ` it offers pi's argument completions (models, thinking levels, providers, extension completions). `/model`, `/thinking`, `/login`, `/logout`, `/settings`, `/new`, `/name`, `/session`, `/compact` and `/reload` open the same pickers as pi's TUI as cards, and `/mcp` opens pi's MCP manager. Web threads load pi's built-in MCP, codemode and tool-search extensions, as the pi CLI does.

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

Type `/` in the composer for commands: arrow keys pick, Tab completes, Enter runs, Esc closes. **Settings** in the sidebar sets the theme and the default model for new threads (pi's global `defaultProvider`/`defaultModel`, the same setting the TUI's `/model` saves). `/login` sign-in links and device codes appear as notices in the thread. OAuth flows that redirect to `localhost` reach the machine running pi, so when the browser is elsewhere, paste the code or redirect URL into the card when pi asks for it.

### Terminal

**Terminal** in a thread's header (or Ctrl+`) opens a shell docked under the transcript, started in the thread's working directory. It uses `$PI_WEB_SHELL`, then `$SHELL`, then bash, as a login shell. The shell belongs to the thread, not the browser tab: hiding the panel or reloading the page leaves it running, and reopening it replays recent output. It ends when you exit it, press **Kill**, or the server stops. Every browser looking at the thread shares the same shell. On touch screens a key strip adds Esc, Tab, Ctrl+C, Ctrl+D and arrows.

The shell runs as the user running pi, with the same rights the agent's bash tool has. Only pages served by the web UI itself can open it: the WebSocket checks that `Origin` matches the host, and that the host is an IP address, `localhost`, a MagicDNS name (`box` or `*.ts.net`), or listed in `PI_WEB_ALLOWED_HOSTS`. That keeps other sites open in the same browser out, including through DNS rebinding. Behind the cyac proxy (`pi.<box>.<root>`), set `PI_WEB_TRUST_PROXY=1`: the proxy only forwards hosts it serves and sets `X-Forwarded-Host`, which a browser can't add to a WebSocket itself. If pi was started with Linux `no_new_privs` set (systemd `NoNewPrivileges=yes`, or options that imply it such as `SystemCallFilter=`, `RestrictSUIDSGID=`, `MemoryDenyWriteExecute=`, `DynamicUser=`; Docker `no-new-privileges`), sudo can't work in the shell or for the agent, and the panel says so. That flag is inherited and can't be cleared from inside, so it has to be turned off where pi is launched.

PTY support comes from `@lydell/node-pty` prebuilds (Linux, macOS and Windows on x64 and arm64). On other platforms the panel shows an error and everything else keeps working.

### Settings

`/web host:port` wins over these; the rest only come from the environment.

| Variable | Default | |
| --- | --- | --- |
| `PI_WEB_HOST` | `127.0.0.1` | Bind address |
| `PI_WEB_PORT` | `8787` | |
| `PI_WEB_AUTOSTART` | off | Start the server when pi loads the extension |
| `PI_WEB_CWD` | pi's working directory | Default working directory for new threads (`~`/`~/…` resolve) |
| `PI_WEB_SESSION_DIR` | pi's default | Keep web threads in their own session folder |
| `PI_WEB_STATE_FILE` | `~/.pi/agent/pi-web/threads.json` | UI-only state (archived flags) |
| `PI_WEB_IDLE_MINUTES` | `30` | Idle, unwatched sessions are unloaded and reopen from disk on demand |
| `PI_WEB_TERMINAL` | on | `0` turns the shell panel off |
| `PI_WEB_SHELL` | `$SHELL` | Shell for the terminal panel |
| `PI_WEB_ALLOWED_HOSTS` | none | Extra host names for the terminal (comma-separated, `.example.com` covers subdomains), e.g. behind your own reverse proxy |
| `PI_WEB_TRUST_PROXY` | off | `1` when a reverse proxy that only forwards its own hosts sits in front, such as the cyac proxy: the terminal then accepts the host in its `X-Forwarded-Host` |

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
- No branching UI, image upload or file browser yet.
- Terminal shells are not kept across server restarts.
- `/settings` shows the settings that matter outside a terminal; display options for pi's TUI are left out.

## Fonts

ModeNine (`web/public/fonts`) is freely distributable on the condition that its readme travels with it; it does.
