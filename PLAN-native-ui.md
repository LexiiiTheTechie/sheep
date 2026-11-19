# PLAN: Native UI to replace Gradio

**Status:** In Progress (Phase P0 & P1 Native UI + Rust Backend running)
**Supersedes:** nothing (adds to `PLAN-stage-a-tauri-shell.md`)
**Owner:** Sheep

> **Current Implementation State:**
> - `ui/` created with React 19 + TypeScript + Vite + Tailwind CSS v4.
> - Embedded **Rust Axum web server** running on `http://0.0.0.0:7850`, serving `ui/dist` and proxying model/chat completions directly to the local Python engine.
> - **Dual Access:** Accessible via the native Tauri desktop window AND via any standard web browser across the network.
> - **Rust SQLite & Auth:** `user_data/sheep.db` with native Argon2id password hashing and UUID session tracking.
> - **Slot Manager:** Atomic slot allocation enforcing `max_active_users` (default: 3) with hard lockout and single-user multi-device awareness.
> - **First-run setup prompt:** Implemented via `AuthModal.tsx` and `/api/auth/first-run`.

---

## 0.1 Decisions log (confirmed by the user)

| Date | Decision |
|---|---|
| 2026-11-18 | **React** (React 19 + TypeScript + Vite) for the UI. |
| 2026-11-18 | **Rust Backend Services**: Web server, auth, sessions, SQLite, and slot manager implemented directly in Rust (Axum + Tokio + rusqlite + Argon2id). |
| 2026-11-18 | **Dual Access**: Tauri desktop window + standard web browser client supported concurrently on `http://0.0.0.0:7850`. |
| 2026-11-18 | **Auth enabled by default**, with a **first-run prompt** letting the user create the initial owner account. |
| 2026-11-18 | **Per-user isolation is mandatory**: separate chats, separate loaded models, no cross-user access. See §6.9. |
| 2026-11-18 | **SQLite** for accounts and sessions. |
| 2026-11-18 | **Extensions are out of scope** for now; they may be redesigned later. |
| 2026-11-18 | Accounts are a first-class feature, not a LAN-only toggle. |
| 2026-11-18 | **Isolation is absolute and non-negotiable.** Not even the owner can read another user's chats. Admin powers are lifecycle-only. |
| 2026-11-18 | Unlimited accounts and sessions; **at most N distinct users may hold a model slot at once** (`max_active_users`, default 3). **Admin/owner can configure this limit in Settings.** A user with several sessions holds one slot. |
| 2026-11-18 | **Hard lockout, no auto-timeout**: slots are released ONLY by explicit model unload, logout, or owner force-release. Inactive users do not get timed out automatically. |
| 2026-11-18 | Separate **Account** screen (profile, password, sessions, export, delete) and **Settings** screen (engine/app configuration). |
| 2026-11-18 | Every user gets **export chat** and **export all my data**. |
| 2026-11-19 | **Multi-Chat Management & History**: Persistent SQLite-backed `chats` and `messages` tables with per-user isolation, auto-titling, and left drawer. |
| 2026-11-19 | **Message Editing & Regeneration**: Inline editing for both user & assistant messages, automatic truncation & re-generation on user message edits, and one-click regenerate for the last assistant response. |
| 2026-11-19 | **Message Deletion**: Users can delete individual messages or clear threads; deleted messages are purged from context with zero residual memory. |
| 2026-11-19 | **Right Options Panel & Multi-format Export**: Engine status, turn statistics, and one-click export to `.json`, `.jsonl`, `.txt`, and `.md`. |
| 2026-11-19 | **Markdown Rendering**: Full GitHub Flavored Markdown (tables, lists, codeblocks) via `react-markdown` + `remark-gfm`. |

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
3. Accounts enabled by default, with a first-run prompt; secure by construction
   (§6).
4. **Strict per-user isolation**: each account has its own chats and its own
   loaded model, and cannot see or affect another account's data (§6.9).
5. Same engine, same `settings.yaml`, same `user_data/` layout. No data migration.
6. Runs inside the existing Tauri shell, which stops navigating to a remote URL
   and serves bundled assets instead.
7. Keep `--nowebui`, `--api`, `--listen` working. The OpenAI-compatible API is
   unchanged.

### Non-goals

- Rewriting inference, sampling, loaders, or model handling.
- Cloud/multi-tenant deployment. This is a local desktop app that *can* be
  exposed on a LAN.
- **Extensions.** Out of scope for this plan; extension tabs disappear with the
  Gradio UI and can be redesigned later.
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
| Extensions | `modules/extensions.py:229` | **Out of scope.** Extension tabs are dropped with Gradio; no replacement in this plan. |

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
| UI | React 19 + TypeScript + Vite | **decided** (§0.1); largest ecosystem and the most reliable code-generation target |
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
| Models | `GET /models`, `GET /models/slot`, `POST /models/slot/load`, `POST /models/slot/unload`, `POST /models/slot/queue`, `DELETE /models/slot/queue`, `GET /models/download`, `GET /models/download/{id}` | slot is always the caller's; load is long-running → job id; `409 SLOTS_FULL` carries queue position |
| Account | `GET /account`, `PATCH /account`, `POST /account/export`, `POST /account/delete`, `GET /account/sessions`, `DELETE /account/sessions/{id}` | self-service only |
| Admin | `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/{id}`, `DELETE /admin/users/{id}`, `GET /admin/slots`, `POST /admin/slots/{id}/release` | owner only; **no read access to user content** |
| Chat | `GET /chats`, `POST /chats`, `PATCH /chats/{id}`, `DELETE /chats/{id}`, `GET /chats/{id}/messages`, `POST /chats/{id}/generate`, `POST /chats/{id}/stop`, `POST /chats/{id}/regenerate`, `POST /chats/{id}/branch` | caller-scoped; generation returns `text/event-stream` |
| Completions | `POST /completions` (SSE), `POST /completions/stop` | notebook/default tab |
| Parameters | `GET/PATCH /parameters`, `GET /presets`, `POST /presets`, `DELETE /presets/{name}`, `GET /grammars` | writes through existing preset code |
| Characters | `GET/POST/PATCH/DELETE /characters`, `POST /characters/import` | YAML/JSON/PNG import reuses existing parsers |
| Settings | `GET/PATCH /settings`, `POST /settings/apply` | `settings.yaml` stays the source of truth |
| Files | `POST /files/pick-directory`, `POST /files/upload`, `GET /files/download` | picker goes through Tauri IPC when bundled |
| Extensions | — | **out of scope** (§2) |
| Auth | `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` | see §6 |
| Export | `GET /export/chat/{id}` (json/markdown), `POST /export/all` | own data only; short-lived token |
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
  uuid TEXT UNIQUE NOT NULL,              -- opaque id used in paths and the API
  username TEXT UNIQUE NOT NULL,          -- compared case-insensitively
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
model_slots(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  model TEXT,
  api_port INTEGER,
  llama_port INTEGER,
  state TEXT NOT NULL DEFAULT 'empty',    -- empty | queued | loading | ready | failed
  claimed_at INTEGER,
  last_used_at INTEGER,
  pid INTEGER
)
slot_leases(                              -- one row per active session holding the slot
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (session_id)
)
slot_queue(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)
audit(
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,                    -- login_ok, login_fail, lockout, setup,
                                          -- logout, password_change, forbidden_access
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

Accounts are **on by default**. On first launch the user is shown a setup screen
with two choices:

1. **Create an account** (recommended, and required when listening beyond
   loopback). Ask for username and password, with a strength hint. The first
   account becomes `owner`.
2. **Continue without an account** — explicit, one click, and only offered when
   the app is bound to loopback. It is recorded in `settings.yaml` as
   `auth.mode: local`, so the user is not asked again. This can be reversed from
   Settings or with `sheep --enable-auth`.

After setup, login is required on every launch unless "remember this device" was
chosen, which issues a normal session (still hashed at rest, still expiring).

Rules that follow from "secure by default":

- `--listen` with `auth.mode: local` **refuses to start** unless
  `--allow-insecure` is passed; it prints exactly what to run to create an
  account.
- There is no skipped-then-silently-exposed path: the check is at startup, not
  at request time.
- Recovery happens locally: `sheep --reset-password <username>` (prompts on the
  terminal, never takes the password as an argument).
- No email recovery: local CLI access is equivalent to physical access.

### 6.8 What we deliberately do not do

- No default account, no `admin/admin`.
- No "remember me" token that is not hashed at rest.
- No password hints or security questions.
- No auth logic duplicated in the frontend; the UI only reflects `GET /auth/me`.
- No password ever passed as a command-line argument or environment variable.

### 6.9 Per-user isolation

Every account is a separate world. This is a hard requirement, not a nicety.

**Data layout**

```
user_data/
├── accounts.db                  # users, sessions, audit (shared, 0600)
├── settings.yaml                # machine config (shared, owner-writable)
└── users/
    ├── <uuid>/                  # one directory per account, mode 0700
    │   ├── chats/               # this user's chat histories only
    │   ├── characters/
    │   ├── presets/
    │   ├── settings.yaml        # per-user preferences (theme, style…)
    │   └── files/               # uploads, attachments, generated images
    └── ...
```

The `owner` account may read shared settings; other accounts can read the shared
configuration they need (model paths, flags) but never another user's directory.

**Authorization rules**

- Every request resolves the session to a `user_id`; there is no anonymous path.
- Resource lookups are scoped: `SELECT … WHERE user_id = ?`. Chat, character,
  preset, and file IDs are opaque UUIDv7, and a lookup that does not match the
  caller returns `404`, not `403`, so existence is not leaked.
- SSE streams are bound to the session that opened them; a stream cannot be
  resumed by another user, and the generation's owner is checked on `stop`.
- Audit every cross-boundary attempt (`forbidden_access`) with the source.

**Per-user model loading and the concurrency cap**

Three different things are easy to confuse:

| Thing | Limit | Why |
|---|---|---|
| Accounts | unlimited | free to create |
| Signed-in sessions | unlimited | a signed-in session costs nothing; the same user may have several |
| **Users actively holding a model slot** | **`max_active_users`, default 3** | this is the real resource: memory, VRAM, and compute |

So "3" is **not** "3 people may be logged in". It is "3 distinct people may
have a model in use at once". Everyone else stays signed in, browses history,
edits settings, and sees a clear message: *"All 3 model slots are in use."*

Rules:

- A slot is **claimed** when the user loads a model (or sends the first message
  that needs one) and **released ONLY when explicitly unloaded, the user logs out,
  or the owner force-releases it**. There is **no automatic inactivity/idle timeout**.
- **Configurable slot capacity:** The owner/admin can configure `max_active_users`
  (default 3) in Settings at any time to match their hardware capacity.
- **Hard lockout when full:** When `max_active_users` distinct users hold a slot, any
  additional user is hard locked out from using the model or chatting until one of the
  active users explicitly releases their slot (or logs out / is force-released by the owner).
- **One slot per account, never per session.** A user with three windows or two
  devices holds one slot; reference-counted across that user's sessions, so closing
  one window does not free it while another session for that user remains open.
- Slots are claimed in a **single SQLite transaction** (`BEGIN IMMEDIATE`) so two
  users racing for the last slot cannot both win.
- No preemption: an active user is never silently evicted.

**A second, separate limit: loaded model instances**

Slots are a policy cap. Memory is a physical cap, and it applies to *distinct
models*, not users:

- If two users load the **same** model, they **share one `llama-server` process**
  and get separate conversations. That is the common case on a shared machine
  and it costs nothing extra.
- If they load **different** models, each needs its own process. The engine
  allows `max_loaded_models` (auto-detected from available memory, owner
  overridable). When the next distinct model does not fit, the request fails with
  "only N distinct models can be resident; unload one or wait" — never by
  evicting someone else's model.
- Concurrent generations within one shared server are bounded by llama.cpp's
  `--parallel`; the plan caps it at the number of active slots so latency stays
  predictable.

This gives three independent guards, each with one job:

```
max_active_users   = 3      policy: how many people may hold a slot
max_loaded_models  = auto   physics: how many distinct models fit
max_parallel_gen   = 3      latency: how many generations at once
```

**Why not cap by "signed in"**

Because it is the wrong resource. A session on a sleeping phone would occupy one
of three seats and block a person who is actually working. Capping the *slot*
means the seats are held by whoever is using a model right now, and an idle seat
frees itself.

**Cost warning, stated once:** loading a second distinct model is expensive.
This design is honest about hardware limits instead of pretending every user can
have a 12 B model resident at the same time.

**Absolute isolation is non-negotiable.** The owner is an administrator, not a
reader: no account can read another account's chats, characters, presets, files,
or generation streams, including the owner. Administrative actions available to
the owner are limited to account lifecycle (create/disable/delete), slot
force-release, and server-wide settings. Support requests are handled with
"export my data", not by reading someone's conversations.

---

## 7. UI structure

One window, a persistent left rail, and a content region. Screens map 1:1 to the
old tabs so muscle memory survives. Before the rail, two full-window states:
**first-run setup** (create account or continue locally) and **login**.

```
┌────────────┬──────────────────────────────────────────────┐
│ Chat       │  Chat                                        │
│ Notebook   │  ┌────────────────────────────────────────┐  │
│ Parameters │  │ messages (virtualised list)            │  │
│ Character  │  │                                        │  │
│ Model      │  └────────────────────────────────────────┘  │
│ ────────── │  [ composer ]  [Send] [Stop]                 │
│ Account    │  right drawer: modes, style, character       │
│ Settings   │                                              │
│ (Admin)    │  slot banner: "model in use · 2 of 3 slots"  │
└────────────┴──────────────────────────────────────────────┘
```

**Account** and **Settings** are deliberately separate screens:

| Screen | Contains | Who |
|---|---|---|
| Account | username, change password, active sessions/devices with revoke, **export all my data**, **delete my account**, theme preference | every user, own data only |
| Settings | model directory, generation defaults, application flags, slot policy (`max_active_users`), auth mode, startup behaviour | owner; users see only their own preferences |
| Admin | user list, create/disable/delete, slot table with force-release | owner only, **content-free** |

A "3 of 3 slots in use" state is a first-class part of the UI, not an error
dialog: the Chat screen shows the banner, the composer disables, and a queue
button appears with position and estimated wait.

Priority tiers:

- **P0 (must ship):** Chat, Model, Parameters, Settings, Account.
- **P1:** Notebook, Character, preset management, file save/load, settings
  persistence, keyboard shortcuts, export (chat + all data).
- **P2:** Image AI, Training, audio notification, update check, Admin screen.
- **Dropped:** Extensions (§2).

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
| **P3 — accounts + isolation** | SQLite store, Argon2id, sessions, rate limiting, first-run setup, login screen, CLI reset, `--listen` enforcement, per-user data dirs, slot claiming with the 3-user cap, queue, Account screen, export, delete account | Isolation tests pass (A cannot read/stop/see B, including as owner); slot-race test passes; export contains exactly one user's data |
| **P4 — breadth** | Characters, Image AI, Training, audio notification, update check | Feature checklist in §4 complete or explicitly waived |
| **P5 — cutover** | `--ui native` default, Gradio behind `--ui gradio`; delete Gradio UI code once stable | No user-visible regression for one release cycle |

Rough effort: P0–P2 is the bulk (~3–5 weeks of focused work), P3 ~1 week,
P4 open-ended and partly optional.

---

## 11. Testing

- **API contract:** pytest against the FastAPI app with a temporary `user_data`;
  every endpoint, including error codes.
- **Auth:** hash format, parameter upgrades, lockout timing, session expiry,
  token hashing, unknown-user timing parity, `--listen` refusal.
- **Isolation (must be adversarial, not happy-path):**
  - user A requests user B's chat id → `404`, and the contents are never read;
  - A calls `stop` on B's generation → rejected, B's stream continues;
  - A attempts `PATCH`/`DELETE` on B's chat/preset/file → rejected;
  - A cannot see B's model slot state or unload it;
  - two users load different models simultaneously and each gets its own port;
  - after A logs out, A's cookie cannot reach any endpoint.
- **Streaming:** assert tokens arrive, `stop` cancels within a second, and a
  dropped connection does not leak a generation thread.
- **UI:** Vitest for stores; Playwright against the SPA in Chromium using a
  stub API (Playwright cannot drive WKWebView).
- **Browser-based manual checks:** the API and SPA can be exercised in a real
  browser against a project-local engine (start the engine on a spare port and
  open `http://127.0.0.1:<port>`), which is faster than describing a bug.
  **Never point a browser at the user's personal TextGen install.**
- **Shell:** keep the existing stub-engine smoke test (`SHEEP_SMOKE_CLOSE_MS`).
- **Manual matrix:** macOS arm64 first, then Windows, then Linux.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Second model does not fit in VRAM | Load failure | explicit slot limits, clear error, owner-configurable cap |
| A bug leaks one user's chat to another | Privacy breach | every query scoped by `user_id`; adversarial isolation tests in CI |
| Model load blocks the event loop | UI freezes | jobs + thread pool, never in a request handler |
| Two sources of settings | Drift and data loss | API writes through existing functions only |
| Auth bugs | Account compromise | no custom crypto, dedicated tests, CLI recovery |
| Scope creep into a "real" app shell | Never ships | parity list is the contract; no settings rewrite here |
| Tauri/WebKit quirks | Rendering gaps | test early on macOS; SSE is well supported |
| Gradio stays as a second UI | Double maintenance | hard cutover phase P5, delete rather than freeze |
| Extensions dropped | Users of superbooga etc. lose tabs | documented, deliberate; can be redesigned later |

---

## 13. Decisions

Resolved (see §0.1): React; auth on with a first-run choice; per-user isolation;
SQLite; extensions out of scope.

Still open:

1. **Gradio lifetime:** delete at P5, or keep `--ui gradio` for one release
   cycle? Recommendation: keep for one cycle.
2. **Slot default:** `max_model_slots` = 1 or 2 out of the box? Recommendation:
   2 when the machine has ≥32 GB unified memory, else 1.
3. **Owner powers:** may the owner read other users' chats (admin support) or is
   isolation absolute? Recommendation: absolute, with an explicit
   "export my data" path instead.
