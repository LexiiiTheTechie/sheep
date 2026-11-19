# Sheep Development Changelog & Implementation State

This document tracks all changes, design decisions, and current progress for Sheep (replacing Electron & Gradio with Tauri v2 + React 19 + Native Rust services).

---

## [2026-11-19] - Multi-Chat, Message Editing, Regeneration, Deletion, Right Sidebar & Multi-Format Exports

### 1. Implemented Features
- **Multi-chat Management**:
  - Full SQLite persistence for `chats` and `messages` tables with strict user isolation (`WHERE user_id = ?`).
  - Conversation drawer (`ChatHistoryPanel.tsx`) with conversation creation (+ button), inline rename, and deletion with confirmation.
  - Automatic conversation titling based on the first user prompt (truncated to 60 characters).
  - REST endpoints on Rust Axum server: `GET /api/chats`, `POST /api/chats`, `GET/PATCH/DELETE /api/chats/:id`, `GET/POST /api/chats/:id/messages`, `PATCH/DELETE /api/chats/:id/messages/:msg_id`, `POST /api/chats/:id/messages/:msg_id/truncate`.
- **Markdown & Code Highlighting**:
  - Integrated `react-markdown` and `remark-gfm` with GitHub Flavored Markdown support (tables, lists, inline code, preformatted codeblocks).
- **Message Editing & Deletion**:
  - Hover-revealed pencil and trash can icons on all user and assistant message bubbles.
  - Inline textarea with `Ctrl+Enter` save and `Escape` cancel shortcuts.
  - Editing user messages automatically truncates subsequent messages and triggers re-generation with updated history.
  - Editing assistant messages updates responses directly in-place.
  - Deleting messages removes them immediately from SQLite with zero residual memory in subsequent generation context.
- **Response Regeneration**:
  - Dedicated "Regenerate" button under the last assistant message.
  - Deletes the existing model response and prompts generation again with previous conversation context.
- **Right-Hand Chat Options Sidebar (`ChatOptionsPanel.tsx`)**:
  - Active engine status, slot occupancy indicator, and thread turns statistics.
  - One-click multi-format chat export: **`.json`**, **`.jsonl`**, **`.txt`**, and **`.md`**.
  - One-click clear thread messages action.
- **Model Discovery & Polling**:
  - Re-polling logic in `App.tsx` every 5s so server-resident GGUFs are automatically populated in the Model Tab. Handled `"None"` response gracefully.

---

## [2026-11-18] - Native UI & Rust Backend Transition

### 1. Architectural Decisions (Confirmed)
- **UI Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Lucide Icons (`ui/`).
- **Rust Backend:** Auth, sessions, user isolation, and concurrency slot management are implemented directly in compiled Rust inside Tauri (`src-tauri/`) rather than in Python.
- **Strict User Isolation:**
  - Absolute privacy: no cross-user access to chats, presets, or files. Even server owners/admins cannot inspect other users' private conversations.
  - Accounts and sessions stored in local SQLite (`user_data/sheep.db`) using WAL mode.
  - Password hashing with **Argon2id** and random salts via `OsRng`.
- **Model Slot Concurrency Cap & Hard Lockout:**
  - `max_active_users` (default: 3) controls how many distinct accounts can actively run a model / chat concurrently.
  - **Single User, Multiple Devices:** Sessions from the same user account across multiple tabs/devices consume only **1 slot**.
  - **Hard Lockout:** When capacity is full, additional users are hard locked out with a clear indicator in the UI.
  - **No Automatic Timeout:** Slots are never silently expired by idle timers; they are released only on explicit model unload, logout, or admin force-release.
  - **Admin Control:** Server owners can change `max_active_users` dynamically in the Settings tab.
- **Data Sovereignty:**
  - Dedicated **Account Tab** providing self-service password updates, active session revocations, and one-click data export:
    - `Export Single Chat` (.md / .json)
    - `Export All My Data` (.json / archive)
    - `Delete My Account` (cascades database rows)
  - Dedicated **Settings Tab** separating host and capacity settings from personal account management.

---

### 2. Implemented Components

#### A. Frontend (`ui/`)
- **Scaffold:** Complete React 19 + TypeScript + Tailwind CSS project with Vite.
- **Components:**
  - `Sidebar.tsx`: Left rail navigation and dynamic slot capacity gauge (`activeUsers / maxActiveUsers`).
  - `ChatTab.tsx`: Multi-turn chat view with SSE streaming integration, stop-generation abort, and hard-lockout overlay.
  - `ModelTab.tsx`: GGUF model browser, active model indicator, and slot claim/release controls.
  - `ParametersTab.tsx`: Presets (`Default`, `Creative`, `Precise`) and controls for Temperature, Top-P, Repetition Penalty, and Max Tokens.
  - `AccountTab.tsx`: Isolated user profile view, session list with device revoking, password change, and full export capabilities.
  - `SettingsTab.tsx`: Model directory browsing and admin capacity slider (`max_active_users`).
- **API Services:**
  - `ui/src/api/client.ts`: Connects to local FastAPI backend for model list, load/unload, and streaming chat completions.
  - `ui/src/api/tauriAuth.ts`: Typed IPC bridge to Tauri Rust commands.

#### B. Rust Backend (`src-tauri/`)
- **`src-tauri/src/db.rs`:**
  - SQLite database management using bundled `rusqlite`.
  - Tables: `users`, `sessions`, `system_config`.
  - Native Argon2id hashing and password verification.
- **`src-tauri/src/slots.rs`:**
  - Thread-safe `SlotManager` enforcing atomic slot allocation and the 1-slot-per-user rule.
- **`src-tauri/src/auth_commands.rs`:**
  - Registered Tauri commands: `check_first_run`, `setup_owner`, `login`, `get_current_user`, `logout`, `get_user_sessions`, `revoke_session`, `update_password`, `delete_account`, `get_slot_status`, `claim_slot`, `release_slot`, `admin_force_release`, `set_max_active_users`.
- **`src-tauri/permissions/sheep.toml` & `capabilities/shell.json`:**
  - Updated Tauri v2 capabilities and command permission sets.
- **`src-tauri/tauri.conf.json` & `src/main.rs`:**
  - Pointed `frontendDist` to `../ui/dist`.
  - App window serves the React SPA locally with native speed and zero startup flash.

---

### 3. Current Verification State
- `ui`: Builds with zero TypeScript / compilation errors (`npm run build`).
- `src-tauri`: Compiles cleanly with zero warnings or errors (`cargo check`).

---

### 4. Roadmap & Next Steps
- [ ] Connect the first-run owner account setup modal in the React UI on startup.
- [ ] Connect local chat persistence in SQLite (store chat messages and history per user).
- [ ] Verify packaging (`cargo tauri build`) for macOS Apple Silicon.
- [ ] Windows x64 and Linux verification on real hardware.


## [2026-11-18] - Dual Web Client & Embedded Rust Axum Server

### Changes:
- **Rust Axum Server (`src-tauri/src/web_server.rs`):**
  - Embedded high-performance async HTTP server built on `axum`, `tower-http`, and `tokio` running on port `7850` (listening on `0.0.0.0`).
  - Directly serves the compiled React UI (`ui/dist`) as static assets.
  - Exposes REST endpoints for authentication and slot capacity (`/api/auth/*` and `/api/slots/*`).
  - Proxies model listing, loading, unloading, and streaming chat completions (`/v1/internal/*` and `/v1/chat/completions`) directly to the Python LLM engine.
- **Universal Web Client Support:**
  - Sheep is now accessible through both the **Tauri desktop window** AND any **standard web browser** (Chrome, Safari, Firefox, mobile browsers on LAN) at `http://localhost:7850` or `http://<LAN-IP>:7850`.
- **First-Run Setup & Auth Flow:**
  - `AuthModal.tsx` handles initial Administrator account creation (`/api/auth/setup`) and subsequent logins.
  - Users are authenticated directly against Rust's SQLite database (`user_data/sheep.db`).
- **Verified End-to-End:**
  - First-run check: verified (`{"is_first_run": true}`).
  - Account creation: created owner account `lexi` with Argon2id hash.
  - Model list proxy: returned `["qwen2.5-0.5b-instruct-q4_k_m.gguf"]` from the engine.
  - Slot manager: tracking active users and hard lockout state.
