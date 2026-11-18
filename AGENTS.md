# AGENTS.md — Sheep

Instructions and state for AI coding agents working in this repository.
Read this before changing anything. `src-tauri/README.md` is the human-facing
version of the same information.

---

## 1. What this project is

Sheep is a desktop app for a fork of **TextGen** (`oobabooga/text-generation-webui`).

TextGen is a **Python** program that loads models, runs inference, and serves a
**Gradio** web UI on `127.0.0.1:7860`. Upstream shipped an **Electron** wrapper
(~150 MB) that started that Python process and opened the UI in a Chromium
window.

Sheep replaces Electron with **Tauri v2** (Rust + the operating system's own
webview: WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux).

**The Python engine is not being rewritten.** The UI is still Gradio, still
upstream code. Rust owns only the process lifecycle and the window. Do not
start porting the UI to Rust, and do not add settings screens — that is a later
project (`settings/flocks/CMD_FLAGS` rewrite) and is explicitly out of scope.

Process chain:

```
Sheep (Rust + webview)  →  engine (Python, server.py)  →  llama-server (C++) for GGUF
```

---

## 2. Hard rules

These are not style preferences. Violating them has already caused real damage
or real user anger.

1. **Never read, execute, or write anything outside the repository** without
   explicit permission. In particular the user has a personal TextGen install
   at `~/Downloads/textgen-4.9` containing irreplaceable models. Do not run it,
   do not point `SHEEP_PYTHON` at it, do not modify it.
   `src-tauri/src/paths.rs` enforces this in code: any interpreter outside the
   project root is refused unless `SHEEP_ALLOW_EXTERNAL_PYTHON=1` is set.
2. **Never kill, displace, or signal a process by port.** The user runs other
   local LLM servers (TextGen on 7860, NemoMix `llama-server` on 5005, macOS
   ControlCenter on 5000). Port selection only *probes*. The only signal Sheep
   sends is to the process group / Job Object it created itself.
3. **Keep the Python surface unchanged when possible.** Upstream compatibility
   is a feature. Reach for `TEXTGEN_ELECTRON=1`, the IPC bridge, or a Rust-side
   fix before editing `server.py` / `modules/`.
4. **No floating console windows.** Especially on Windows: `CREATE_NO_WINDOW`.
5. **AGPL-3.0 compliance.** This is a fork of an AGPL project. Do not add code
   that cannot be distributed under that licence.
6. **Do not delete `desktop/` yet.** It is the current shipping launcher until
   the Tauri app has full parity (see §8). Delete it only after the checklist
   is genuinely complete and the user agrees.
7. **Do not commit `portable_env/`, `user_data/`, `cache/`, or `src-tauri/target/`.**
   They are gitignored; keep it that way.
8. **Browser-based testing is allowed, but only against a project-local engine.**
   Start the engine inside the repo on a spare port and inspect that. Never open
   the user's personal TextGen install in a browser, even read-only.

---

## 3. Layout

```
sheep/
├── server.py, modules/, extensions/   # upstream TextGen engine (Python 3.13)
├── js/, css/                          # Gradio UI assets
├── user_data/                         # models, settings (gitignored)
├── portable_env/                      # project-local Python 3.13 venv (gitignored)
├── desktop/                           # LEGACY Electron wrapper — remove after parity
├── src-tauri/                         # the Tauri shell — the actual product
│   ├── src/main.rs                    # windows, splash, readiness, watchdog, signals
│   ├── src/engine.rs                  # spawn, ports, readiness, log capture, tree kill
│   ├── src/paths.rs                   # app dir + interpreter discovery (containment)
│   ├── src/bridge.rs                  # window.electronAPI shim + IPC commands
│   ├── src/args.rs                    # --help / --nowebui / --listen passthrough
│   ├── src/menu.rs                    # macOS menu bar (Edit menu for ⌘C/⌘V)
│   ├── shell/index.html               # splash + failure screen
│   ├── capabilities/shell.json        # window perms + allowed remote origins
│   ├── permissions/sheep.toml         # app-command ACL
│   ├── dev/stub_server.py             # dependency-free fake engine
│   └── dev/run-stub.sh                # run the shell against the stub
├── .github/workflows/build-portable-release*.yml
├── PLAN-stage-a-tauri-shell.md        # original plan + implementation status
└── AGENTS.md                          # this file
```

---

## 4. How it works

### Startup (`main.rs`, `engine.rs`)

1. `args::parse()` handles the legacy launcher flags first, before any window:
   `--help`, `--nowebui`, `--listen`, `--no-electron` run Python directly and
   exit. Everything else is forwarded to `server.py`.
2. `paths::base_dir()` finds the directory containing `server.py`:
   `SHEEP_APP_DIR` → repo root (debug build) → next to the exe → `../Resources`
   → three levels up (macOS `.app` → `app/`) → cwd.
3. `paths::python()` finds an interpreter **inside the project**: explicit
   `SHEEP_PYTHON` → `portable_env/bin/python3` (or `python.exe`) → nothing.
   There is no `PATH` fallback.
4. UI port: first bindable port in `7860..=7879`, else an OS-assigned port.
5. API port: first `p` in `5000..=5099` / `6000..=6099` where **both `p` and
   `p + 5` are bindable at the same time**. This matters — see §7.2.
6. Spawn `python server.py --api [--portable] --listen-port P --api-port A`.
   - `TEXTGEN_ELECTRON=1` so upstream's Electron-only UI (model dir field,
     Browse button, spellcheck) is enabled with zero Python changes.
   - Unix: `process_group(0)` so the child leads its own group.
   - Windows: `CREATE_NO_WINDOW`, then assigned to a Job Object.
7. Two threads pump stdout/stderr to the terminal and `cache/sheep-shell.log`.
8. Window starts on the splash (`shell/index.html`), then navigates to
   `http://127.0.0.1:P/` once the log line `Running on local URL:` appears or
   `/` returns HTTP 200. Deadline: 180 s.
9. If the engine exits first, the splash shows the exit code, log tail, and log
   path (`window.sheepFail` in `shell/index.html`).
10. After navigation a watchdog polls the child; if it dies, show an error
    dialog and exit.

### Shutdown

| Trigger | Behaviour |
|---|---|
| Window closed | `WindowDestroyed` → `app.exit(0)` → `stop()` |
| `Cmd+Q` / app quit | `ExitRequested` / `Exit` → `stop()` |
| `SIGTERM`/`SIGINT`/`SIGHUP` | Signal handler writes a byte to a pipe; a thread calls `stop()` |
| `SIGKILL` | Nothing can run. The engine survives; kill `-INT -<pgid>`. |

`stop()` sends `SIGINT` to the whole process group, waits 8 s, then `SIGKILL`s
the group. On Windows it terminates the Job Object created with
`KILL_ON_JOB_CLOSE`. If the direct child already exited, it does nothing —
never signal a recycled PID.

### UI bridge (`bridge.rs`)

Gradio calls `window.electronAPI.pickDirectory()` from page JS. Tauri provides:

- `INIT_SCRIPT` — injected into the page, defines `window.electronAPI`
  (`pickDirectory`, `ping`, `openExternal`) on top of `__TAURI_INTERNALS__`.
- Commands `pick_directory`, `ping`, `open_external`.
- `capabilities/shell.json` — allows the remote origins
  `http://127.0.0.1:7860`–`7879` to use them.
- `permissions/sheep.toml` — declares `allow-ping`, `allow-pick-directory`,
  `allow-open-external`.

External `http(s)` links are opened in the system browser via
`tauri-plugin-opener`; in-app navigation is restricted to `tauri://` and
loopback.

---

## 5. Build and run

Requires Rust, and for the real UI a project-local Python 3.13 environment.

```sh
# engine environment (once, inside the repo, gitignored)
uv venv --python 3.13 portable_env
uv pip install --python portable_env/bin/python3 -r requirements/full/requirements_apple_silicon.txt

# run the shell
cd src-tauri
cargo run                          # pick a model in the UI
cargo run -- --model qwen2.5-0.5b-instruct-q4_k_m.gguf

# stub engine, no Python deps needed
src-tauri/dev/run-stub.sh

# checks
cargo test                         # paths containment tests
cargo build

# Windows type-check from macOS (needs llvm-rc on PATH; a no-op stub is fine
# because it only compiles resources)
cargo check --target x86_64-pc-windows-msvc
```

### Environment variables

| Variable | Purpose |
|---|---|
| `SHEEP_APP_DIR` | Directory containing `server.py`. |
| `SHEEP_PYTHON` | Interpreter. Refused if outside the project. |
| `SHEEP_SERVER` | Alternative script (used by the stub). |
| `SHEEP_ALLOW_EXTERNAL_PYTHON` | `1` = allow an outside interpreter (dev only). |
| `SHEEP_SMOKE_TEST_MS` | Test-only: `app.exit(0)` after N ms. |
| `SHEEP_SMOKE_CLOSE_MS` | Test-only: close the real window after N ms. |

Smoke hooks also disable the single-instance plugin, so a test run cannot be
silently swallowed by an already-open window.

---

## 6. Verified state (as of the latest commit)

| Area | Status |
|---|---|
| macOS (Apple Silicon) | **Working.** Full path verified with a real GGUF. |
| Window, splash, failure screen | Working |
| Port selection incl. `api_port + 5` | Working |
| `electronAPI` bridge from the remote page | Working (`ipc: "pong"`) |
| Shutdown on window close / `SIGTERM` | Working, zero orphans |
| Interpreter containment | Working, unit-tested |
| Windows | Compiles (`cargo check`). **Never executed.** |
| Linux | **Never built.** Needs WebKitGTK 4.1 + `libayatana-appindicator`. |
| Packaging (`.app`, installers) | Config in `tauri.conf.json` + `Info.plist`; local `.app` build in progress |
| CI | Workflows now build Tauri instead of Electron; not yet run on CI |
| PTY console | Not done; output goes to terminal + `cache/sheep-shell.log` |
| Downloads from the webview | Unverified — Tauri may silently drop them |

Known-good smoke numbers: Qwen2.5-0.5B-Instruct Q4_K_M, ~140 tok/s prompt
eval, ~41 tok/s generation on an M-series Mac.

---

## 7. Gotchas that will waste your day

### 7.1 Remote-origin IPC needs *two* things

Both are required or the command fails with
`<cmd> not allowed. Plugin not found`, which reads like a missing plugin:

1. a capability whose `remote.urls` includes the origin, and
2. an entry in `src-tauri/permissions/sheep.toml` (`allow-<command>`).

### 7.2 `SO_REUSEADDR` lies on macOS

`modules/llama_cpp_server.py::_is_port_available` sets `SO_REUSEADDR`, which
reports a *live* loopback listener as bindable on macOS. TextGen therefore
tries to start `llama-server` on a busy port and the model silently fails with
`couldn't bind HTTP server socket`. Sheep avoids this by holding both `p` and
`p + 5` open simultaneously during selection. Do not "simplify" that check.

### 7.3 Icons

Tauri's context macro requires `src-tauri/icons/icon.png` to be **RGBA**, and
Windows builds need `icon.ico`. Regenerate with `cargo tauri icon <png>` rather
than hand-editing.

### 7.4 macOS ATS

Plain HTTP to `127.0.0.1` needs `NSAllowsLocalNetworking` in the bundled
`Info.plist`, or the release build shows a blank window. Debug builds are not
affected, so this only appears after packaging.

### 7.5 Cross-checking Windows from macOS

`tauri-winres` needs `llvm-rc`, which ships with LLVM. Without it the build
script fails with `NotAttempted("llvm-rc")` — that is a toolchain problem, not
a code problem. A no-op executable named `llvm-rc` early on `PATH` is enough
for `cargo check`.

### 7.6 Never signal by port

See §2.2. If you find yourself writing `lsof`, `pkill -f server.py`, or
`taskkill /IM`, stop.

---

## 8. Remaining work (in priority order)

### 8.1 Replace Electron in the release pipeline with Tauri — **started**

The six `build-portable-release*.yml` workflows no longer download Electron.
Each runner now sets up Rust, builds the shell with `cargo tauri build`, and
places the artifact in `app/`:

- macOS: `Sheep.app` (bundled), launcher execs `app/Sheep.app/Contents/MacOS/sheep`
- Windows: `app/sheep.exe`
- Linux: `app/sheep`

Launchers come from `src-tauri/portable/textgen.sh|bat`, which only locate the
binary; the legacy flag behaviour is implemented in `src-tauri/src/args.rs`.
`desktop/` is no longer referenced by the release and is kept only until the
parity checklist in §8.2 is complete.

Still to verify: an actual CI run on all three runners, and a packaged macOS
build launching from Finder.

Note: the workflows now check out **this fork** rather than
`oobabooga/textgen`, because `src-tauri/` only exists here. The
`version` workflow input is now a release/archive label, not a checkout ref.

### 8.2 Parity checklist before `desktop/` can be deleted

**Platform support: macOS Apple Silicon only.** Intel Macs are explicitly
unsupported and filtered out of the CI matrix. Windows x64 and Linux x64 are
planned.

- [ ] macOS `.app` builds, launches from Finder, respects ATS
- [ ] Windows build runs on real hardware; no console window; Job Object cleanup
- [ ] Linux build runs; Gradio usable under WebKitGTK
- [ ] Release archives contain no Electron and still start correctly
- [ ] Downloads from the Gradio page verified
- [ ] Copy/paste, drag-and-drop and file upload verified on each platform
- [ ] Mirror picker / Browse button verified in packaged builds
- [ ] Spellcheck parity accepted (suggestions are unavailable in WKWebView)

### 8.3 Later

- **Replace Gradio with the native UI** — see `PLAN-native-ui.md`. It is the
  authoritative document; start with its §0.1 decisions log and the "Resume
  here" block at the top. Confirmed: React; accounts **on by default** with a
  first-run prompt; **strict per-user isolation** (own chats, own model slot);
  SQLite; **extensions dropped**.
  Do not start this before the Electron parity checklist above is closed; the two
  cutovers should not overlap.
- Integrated PTY console (replace terminal + log file). The `push_line` seam in
  `engine.rs` is where engine output should feed a terminal widget.
- Signing / notarisation (unsigned macOS builds are quarantined by Gatekeeper).
- Rename `TEXTGEN_ELECTRON` to something Sheep-specific once `is_sheep` is a
  real concept in the Python side.

---

## 9. Conventions

- Rust: no `unwrap` on user-facing paths; return `Result` with a message meant
  for the splash screen. Windows-specific code goes behind `#[cfg(windows)]`.
- Keep `src-tauri/README.md` in sync with behaviour changes (env vars, CLI
  flags, lifecycle table).
- Test with the stub before testing with the real engine — it isolates shell
  bugs from Python bugs.
- Use `cargo fmt` and keep `cargo build` warning-free.
- Commit messages: describe the behaviour change, not the files touched.
