# PLAN: Native UI to replace Gradio

**Status:** proposal, not started
**Supersedes:** nothing (adds to `PLAN-stage-a-tauri-shell.md`)
**Owner:** Sheep

---

## 1. Why

Two problems, one cause.

**Problem A — correctness.** Gradio re-renders by diffing DOM nodes (`morphdom`) from
streamed payloads. Switching away from the Chat tab while a generation is running
means updates are applied to a detached view, and the visible tab shows stale
content until it is re-entered. This is a real, reported bug, and it is a class of
bug that will keep recurring: the UI state lives in the DOM instead of in a store.

**Problem B — control.** The UI, the engine, and authentication are all one
Gradio object. Replacing any one of them means replacing all three. That blocks
the Sheep settings/profile rewrite, blocks a real login system, and makes the
desktop app dependent on a web framework's widget lifecycle.

**Cause:** Gradio is doing three jobs at once — rendering, state, and HTTP
transport. It is good at the first for prototyping, and wrong for the other two
in a desktop app.

**The rule for this project:** the engine stays Python. Only the UI layer is
replaced.

---

## 2. Goals and non-goals

### Goals

1. Full functional parity with today's Gradio UI, tab for tab (§4).
2. Streaming that cannot go stale: state lives in the client store, the view is a
   pure function of it.
3. Optional accounts, secure by construction (§6), toggleable from Settings.
4. Same engine, same `settings.yaml`, same `user_data/` layout. No data migration.
5. Runs inside the existing Tauri shell, which stops navigating to a remote URL
   and serves bundled assets instead.
6. Keep `--nowebui`, `--api`, `--listen` working. The OpenAI-compatible API is
   unchanged.

### Non-goals

- Rewriting inference, sampling, loaders, or model handling.
- Cloud/multi-tenant deployment. This is a local desktop app that *can* be
  exposed on a LAN.
- Reimplementing every extension. Extensions are phased; some stay Gradio-only.
- Mobile.
- Importing Gradio themes. Visual parity is not a goal; functional parity is.

---

## 3. What exists today (parity inventory)

Gradio builds 9 tab modules from `server.py:163`:

| Tab | Source | Must carry over |
|---|---|---|
| Chat | `modules/ui_chat.py` (435 lines) | message list, streaming, stop, regenerate, continue, remove last, impersonate, branch chat, new/rename/delete/incognito, chat search, history, attachments, modes (`instruct`/`chat-instruct`/`chat`), chat style, character selection, tool-approve buttons, send-to-notebook |
| Notebook | `ui_default.py` + `ui_notebook.py` | prompt box, output view (Raw/Markdown/HTML/Logits/Tokens), two-column toggle, grammar, start/stop/continue |
| Parameters | `ui_parameters.py` | generation sliders, sampler settings, preset save/load/delete, instruction template editor |
| Character | `ui_chat.py:155` | character editor, user persona, chat history import, upload YAML/JSON/TavernAI PNG |
| Model | `ui_model_menu.py` (509 lines) | model list, load/unload, refresh, downloader, instruction template, model dir, loaders |
| Image AI | `ui_image_generation.py` (997 lines) | SD WebUI integration: generate, gallery, model (not in portable builds) |
| Training | `modules/training.py` | LoRA training, perplexity evaluation (not in portable builds) |
| Session | `ui_session.py` | theme, show-two-columns, paste-to-attachment, spellcheck, save settings, apply flags/extensions, extension toggles, boolean flags, update check |
| Extensions | `modules/extensions.py:229` | dynamic tabs contributed by `extensions/*` |

Supporting systems that are easy to forget:

- `shared.input_elements` / interface-state persistence (`ui.py:138-315`)
- autosave of settings, debounced (`ui.py:381`)
- file-save dialogs (`ui_file_saving.py`)
- prompt presets and grammars
- keyboard shortcuts (Ctrl+Enter etc.)
- audio notification on completion
- `multi_user` mode: read-only UI, per-user data

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Sheep (Tauri)                                               │
│                                                             │
│  SPA bundle (tauri://localhost)      Rust supervisor        │
│  React + TypeScript + Vite           spawn/kill/log/ports    │
│         │                                   │               │
│         │ HTTP + Bearer token               │ spawns        │
│         ▼                                   ▼               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Control API (FastAPI, 127.0.0.1:PORT_A)                │  │
│  │ /system /models /chat /settings /presets /characters   │  │
│  │ /files /extensions /auth   + SSE streaming             │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ in-process, direct calls         │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │ Engine (Python, unchanged core)                        │  │
│  │ shared, loaders, generate, chat, presets, extensions   │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│                  llama-server (GGUF)                        │
└─────────────────────────────────────────────────────────────┘
```

Three processes stay the same. What changes is the third channel: the UI no
longer talks to Gradio; it talks to a small API over the same engine internals.

### 4.1 Why an HTTP API and not Tauri IPC straight into Python

Tauri IPC only reaches Rust. Python needs a channel that also works in a browser
(the `--listen` case), can stream, and can be tested with `curl`. FastAPI is
already a dependency (`requirements/full/requirements.txt:8`), so this adds no
new runtime.

### 4.2 Why the SPA is bundled, not remote

Today the window navigates to `http://127.0.0.1:7861`, which forces the whole
remote-origin IPC capability machinery (`capabilities/shell.json`,
`permissions/sheep.toml`). With bundled assets:

- the webview origin is `tauri://localhost`, a trusted local origin;
- IPC no longer needs a `remote.urls` entry;
- no web content is loaded from the network at all;
- the `window.electronAPI` shim can eventually be removed.

### 4.3 Authentication handshake (local app)

Passwords never go through argv or environment variables.

1. Rust generates a random 32-byte **API token** per launch.
2. It writes it to `cache/control-token` with mode `0600` and passes the **path**
   to Python via `SHEEP_TOKEN_FILE`.
3. Python reads and immediately unlinks the file, keeping the token in memory.
4. The SPA asks Rust for the token once via a Tauri command `api_token`
   (allowed only from `tauri://localhost`), then holds it in memory.
5. Every request carries `Authorization: Bearer <token>`.

The token identifies *the app to the engine*. It is not a user login; see §6.

### 4.4 Stack

| Layer | Choice | Rationale |
|---|---|---|
| UI | React 19 + TypeScript + Vite | largest ecosystem and the most reliable code-generation target; the UI is state-heavy, not rendering-heavy |
| State | Zustand + TanStack Query | one store per concern; streaming writes to the store, never to the DOM |
| Streaming | SSE (`text/event-stream`) | simpler than WebSocket, works through proxies, auto-reconnect is trivial; generation is one-directional |
| Styling | CSS modules + design tokens | avoid a component framework lock-in while the design is still moving |
| API | FastAPI + uvicorn | already installed; typed models via Pydantic |
| Auth | `argon2-cffi` + SQLite | see §6 |

Alternatives rejected: Svelte (smaller, but fewer agents and contributors know
it), WebSocket-only (bidirectional complexity not needed), Electron-style IPC
bridge into Python (does not work in browser mode).

---

## 5. Control API

Base: `http://127.0.0.1:<api_port>` (Rust picks it, as today). Prefix `/v1/ui`.
All endpoints require the bearer token except `/health`.

### 5.1 Surface

| Group | Endpoints | Notes |
|---|---|---|
| System | `GET /health`, `GET /system` | version, device, ports, loaded model, flags |
| Models | `GET /models`, `GET /models/current`, `POST /models/load`, `POST /models/unload`, `GET /models/download`, `GET /models/download/{id}` | load is long-running → returns a job id |
| Chat | `GET /chats`, `POST /chats`, `PATCH /chats/{id}`, `DELETE /chats/{id}`, `GET /chats/{id}/messages`, `POST /chats/{id}/generate`, `POST /chats/{id}/stop`, `POST /chats/{id}/regenerate`, `POST /chats/{id}/branch` | generation returns `text/event-stream` |
| Completions | `POST /completions` (SSE), `POST /completions/stop` | notebook/default tab |
| Parameters | `GET/PATCH /parameters`, `GET /presets`, `POST /presets`, `DELETE /presets/{name}`, `GET /grammars` | writes through existing preset code |
| Characters | `GET/POST/PATCH/DELETE /characters`, `POST /characters/import` | YAML/JSON/PNG import reuses existing parsers |
| Settings | `GET/PATCH /settings`, `POST /settings/apply` | `settings.yaml` stays the source of truth |
| Files | `POST /files/pick-directory`, `POST /files/upload`, `GET /files/download` | picker goes through Tauri IPC when bundled |
| Extensions | `GET /extensions`, `PATCH /extensions/enabled`, `GET /extensions/{name}/params` | phase 3 |
| Auth | `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` | see §6 |
| Images / Training | phase 4, optional | Gradio-only until then |

### 5.2 Conventions

- Errors: `{"error": {"code": "...", "message": "..."}}` with a stable `code`;
  no Python tracebacks in responses (log tail only, as the splash already does).
- Long operations (model load, download) return `{"job_id": ...}` and are polled
  or streamed; never block a request for minutes.
- Cancellation: `POST /…/stop` signals the same generator stop path Gradio uses.
- Every mutating endpoint writes through the existing Python functions — the API
  is a thin layer, not a second implementation.

### 5.3 Streaming format

```
event: token
data: {"text": "..."}

event: meta
data: {"tokens": 42, "tps": 31.2}

event: done
data: {"message_id": "..."}
```

Rationale: the client can drop events for invisible tabs without losing state,
because the reducer always applies to the store, not to a mounted component.

---

## 6. Accounts and authentication

### 6.1 What Gradio does today (and why it is not enough)

- Credentials come from `--gradio-auth user:pass` or `--gradio-auth-path file`,
  i.e. **plaintext in the process argument list** (visible to any local user via
  `ps`).
- There is no account database. Users exist only for the process lifetime.
- No lockout, no rate limiting, no audit trail, no password change, no roles.
- Passwords are compared against in-memory hashes with a per-process salt; the
  plaintext still originates from argv.

Good enough for "keep a LAN neighbour out", not good enough for a product.

### 6.2 Threat model

| Attacker | Capability | Defence |
|---|---|---|
| Other local user | can read files they own, run `ps` | no secrets in argv/env, `0600` database |
| LAN peer when `--listen` | can reach the HTTP port | auth required for non-loopback, rate limiting |
| Stolen laptop | offline access to disk | Argon2id; passwords not recoverable from hashes |
| Malicious web page in the same browser | CSRF against a LAN-bound instance | `SameSite=Strict` cookies, no CORS, origin check |
| Malicious page in the app webview | none | bundled assets only, no remote navigation |

Not defended against: an attacker with your unlocked OS account and root. That
is out of scope for a desktop app.

### 6.3 Storage

SQLite at `user_data/accounts.db`, directory `0700`, file `0600`, WAL enabled.

```sql
users(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,          -- stored as given, compared case-insensitively
  password_hash TEXT NOT NULL,            -- PHC string, e.g. $argon2id$v=19$m=65536,t=3,p=4$...
  role TEXT NOT NULL DEFAULT 'user',      -- 'owner' | 'user'
  created_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
)
sessions(
  id TEXT PRIMARY KEY,                    -- random, never reused
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BLOB NOT NULL,               -- SHA-256 of the cookie token
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
)
audit(
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,                    -- login_ok, login_fail, lockout, setup, logout, password_change
  username TEXT,
  source TEXT                             -- loopback peer or address
)
```

### 6.4 Password hashing

- **Argon2id** via `argon2-cffi` (defaults: `time_cost=3`, `memory_cost=65536`
  KiB, `parallelism=4`, 16-byte salt, 32-byte output). Store the PHC string, so
  parameters can be raised later and rehashed on successful login.
- Never implement hashing by hand. Never use SHA-256, MD5, or PBKDF2-with-low-
  iterations for passwords.
- Verification is constant-time (`argon2` handles it). For unknown usernames,
  still perform a dummy verify against a fixed hash so response time does not
  reveal account existence.
- Input handling: Unicode NFC normalisation, length 12–1024 bytes, no truncation,
  no silent trimming. Reject the top-10k common passwords (embedded list, no
  network call).
- Passwords are never logged, never returned by any endpoint, never written to
  `settings.yaml`.

### 6.5 Sessions

- 32 random bytes from `secrets.token_urlsafe`, sent as an `HttpOnly`,
  `SameSite=Strict`, `Path=/` cookie; `Secure` whenever TLS is configured.
- Only the SHA-256 of the token is stored, so a database leak cannot be replayed.
- Idle timeout 12 h, absolute 7 days. Sliding expiry updates `last_seen_at`.
- Rotate the session id on login and on password change; revoke all other
  sessions on password change.
- Logout deletes the row.
- In the bundled desktop app the same cookie mechanism is used, but against
  `127.0.0.1` with the bearer token as an additional gate. Do not put tokens in
  `localStorage`.

### 6.6 Abuse resistance

- Per-username and per-source counters. After 5 failures, exponential backoff
  (1 s doubling to 5 min), enforced server-side and persisted in `locked_until`.
- Uniform error message and status for wrong password, unknown user, and
  disabled account.
- Login and setup endpoints are unauthenticated by necessity; they are the only
  ones, and they are rate-limited independently.
- `--listen` without authentication and without a configured account is refused
  at startup with a clear error, unless `--allow-insecure` is passed explicitly.
  This is a behaviour change from Gradio and is intentional.

### 6.7 Enabling and first run

Accounts are **off by default** (single-user local app).

- `Settings → Session → Accounts`: a switch, plus "create account".
- Enabling requires setting a password for the owner account in the same dialog.
- Also available headlessly:
  `sheep --set-password <username>` (prompts on the terminal, never accepts the
  password as an argument) and `sheep --reset-password <username>` for recovery.
- There is no email recovery. The recovery path is local CLI access, which is
  equivalent to physical access.
- Optional later: TOTP second factor, per-user data directories (already
  half-supported by `--multi-user`).

### 6.8 What we deliberately do not do

- No default account, no `admin/admin`.
- No "remember me" token that is not hashed at rest.
- No password hints or security questions.
- No auth logic duplicated in the frontend; the UI only reflects `GET /auth/me`.

---

## 7. UI structure

One window, a persistent left rail, and a content region. Screens map 1:1 to the
old tabs so muscle memory survives.

```
┌────────────┬──────────────────────────────────────────────┐
│ Chat       │  Chat                                        │
│ Notebook   │  ┌────────────────────────────────────────┐  │
│ Parameters │  │ messages (virtualised list)            │  │
│ Character  │  │                                        │  │
│ Model      │  └────────────────────────────────────────┘  │
│ Session    │  [ composer ]  [Send] [Stop]                 │
│ Extensions │  right drawer: modes, style, character       │
└────────────┴──────────────────────────────────────────────┘
```

Priority tiers:

- **P0 (must ship):** Chat, Model, Parameters, Session.
- **P1:** Notebook, Character, preset management, file save/load, settings
  persistence, keyboard shortcuts.
- **P2:** Extensions, Image AI, Training, audio notification, update check.

### 7.1 State model

```
chatStore     { chats, activeId, messagesById, streaming }
modelStore    { models, current, loadJob }
settingsStore { settings, dirty }
uiStore       { screen, drawer, theme, toasts }
```

Rules:

- Streaming writes into `chatStore` only.
- Screens subscribe to slices; unmounting a screen never stops a stream.
- The composer, message list, and drawer are independent subscribers.
- Persistence is a debounced `PATCH` to `/settings`, replacing Gradio's
  `auto_save` machinery.

This is the structural fix for the tab-switch bug: the stream is owned by the
store, not by whichever view happens to be mounted.

---

## 8. Data and compatibility

- `user_data/settings.yaml` stays the canonical settings file; the API calls the
  existing save/apply functions.
- Presets, grammars, characters, chats, and `CmdFlags` paths do not move.
- `shared.args` remains the source of CLI truth. The UI reads it, and "apply
  flags" keeps its existing meaning (save + restart).
- Chat history format is unchanged; the new UI reads and writes the same files.
- The OpenAI-compatible API is untouched. External clients keep working.

---

## 9. Security hardening beyond login

- Bind the control API to `127.0.0.1` unless `--listen` is explicit.
- Reject requests whose `Origin` is not `tauri://localhost` (or the configured
  LAN origin) — no `Access-Control-Allow-Origin: *`.
- CSP: `default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`.
- Uploads: cap size, validate extension, write under `user_data/`, never execute.
- Downloads: serve only from an allowlist of roots.
- No remote navigation in the webview; external links go to the system browser
  (already implemented).
- Rate-limit every unauthenticated endpoint, including `/health` if it is used
  as a liveness probe by others.

---

## 10. Phasing

| Phase | Work | Exit criteria |
|---|---|---|
| **P0 — skeleton** | Vite SPA in `ui/`; Tauri serves it; token handshake; `/health`, `/system`; splash → app | Window renders local assets, no Gradio, no remote origin |
| **P1 — model + chat** | model list/load/unload; chat CRUD; SSE streaming; stop/regenerate; markdown + code highlight; chat persistence | Can load a GGUF and hold a streaming conversation; switching screens mid-stream keeps updating |
| **P2 — parity core** | Parameters + presets; instruction template; Session settings; file save/load; keyboard shortcuts; notebook | Daily use without opening Gradio |
| **P3 — accounts** | SQLite store, Argon2id, sessions, rate limiting, setup/login screens, CLI reset, `--listen` enforcement | Auth tests pass; exposing on LAN is safe by default |
| **P4 — breadth** | Characters, extensions, Image AI, Training, audio notification, update check | Feature checklist in §3 complete or explicitly waived |
| **P5 — cutover** | `--ui native` default, Gradio behind `--ui gradio`; delete Gradio UI code once stable | No user-visible regression for one release cycle |

Rough effort: P0–P2 is the bulk (~3–5 weeks of focused work), P3 ~1 week,
P4 open-ended and partly optional.

---

## 11. Testing

- **API contract:** pytest against the FastAPI app with a temporary `user_data`;
  every endpoint, including error codes.
- **Auth:** hash format, parameter upgrades, lockout timing, session expiry,
  token hashing, unknown-user timing parity, `--listen` refusal.
- **Streaming:** assert tokens arrive, `stop` cancels within a second, and a
  dropped connection does not leak a generation thread.
- **UI:** Vitest for stores; Playwright against the SPA in Chromium using a
  stub API (Playwright cannot drive WKWebView).
- **Shell:** keep the existing stub-engine smoke test (`SHEEP_SMOKE_CLOSE_MS`).
- **Manual matrix:** macOS arm64 first, then Windows, then Linux.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Extension API relies on Gradio components | Extensions break | phase 4; keep Gradio available behind a flag |
| Model load blocks the event loop | UI freezes | jobs + thread pool, never in a request handler |
| Two sources of settings | Drift and data loss | API writes through existing functions only |
| Auth bugs | Account compromise | no custom crypto, dedicated tests, CLI recovery |
| Scope creep into a "real" app shell | Never ships | parity list is the contract; no settings rewrite here |
| Tauri/WebKit quirks | Rendering gaps | test early on macOS; SSE is well supported |
| Gradio stays as a second UI | Double maintenance | hard cutover phase P5, delete rather than freeze |

---

## 13. Open decisions

1. **UI framework:** React (recommended) vs Svelte.
2. **Auth default:** off (recommended for a local app) vs on at first run.
3. **Multi-user:** keep `--multi-user` as read-only mode, or make it real
   per-user accounts? Recommendation: per-user accounts in P3, read-only mode
   dropped.
4. **Extensions:** support all, or document a supported subset?
5. **Gradio lifetime:** delete at P5, or keep `--ui gradio` for one release
   cycle? Recommendation: keep for one cycle.
