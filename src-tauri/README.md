# Sheep desktop shell (`src-tauri`)

Stage A of Sheep: a Tauri v2 replacement for the old Electron wrapper in
`desktop/`. It does not replace the web UI. Python keeps serving Gradio; Rust
owns the process lifecycle and the window.

## What it does

- Finds `server.py` and a Python interpreter.
- Picks a free port starting at `7860` (or honours `--listen-port`).
- Spawns `server.py --api [--portable] --listen-port <port>` in its own
  process group (Unix) or a kill-on-close Job Object (Windows).
- Streams engine output to the terminal and to `cache/sheep-shell.log`.
- Waits for `Running on local URL:` or an HTTP 200, then navigates the window
  to `http://127.0.0.1:<port>/`.
- Shows a Native failure screen with the log tail if the engine does not start.
- Shuts the whole process tree down on window close / quit.
- Provides the `window.electronAPI.pickDirectory()` bridge the TextGen UI
  expects, plus an Edit menu so copy/paste shortcuts work on macOS.
- Routes external links to the system browser.

## Packaging

```sh
cd src-tauri
cargo install tauri-cli --version "^2" --locked   # once
cargo tauri build --bundles app                   # macOS: target/release/bundle/macos/Sheep.app
cargo tauri build --no-bundle                     # Windows/Linux: target/release/sheep[.exe]
```

Release archives use this layout, produced by the six
`.github/workflows/build-portable-release*.yml` jobs:

```
textgen-VERSION/
├── textgen                  # launcher (src-tauri/portable/textgen.sh template)
├── user_data/
└── app/
    ├── server.py, modules/, portable_env/
    ├── Sheep.app/Contents/MacOS/sheep    # macOS
    ├── sheep.exe                         # Windows
    └── sheep                             # Linux
```

The shell finds `server.py` by walking up from the executable, which is why
`app/` is the correct place for the `.app`. `src-tauri/Info.plist` adds
`NSAllowsLocalNetworking` so plain HTTP to loopback is not blocked by App
Transport Security — without it the packaged window renders blank.

## Lifecycle

| Exit path | What happens |
|---|---|
| Close the window | `WindowDestroyed` → engine process group gets `SIGINT`, 8 s grace, then `SIGKILL`. On Windows the Job Object is terminated. |
| App menu Quit / `Cmd+Q` | `ExitRequested` → same shutdown. |
| `Ctrl+C` in the terminal, or `kill <pid>` | `SIGTERM` / `SIGINT` / `SIGHUP` are caught and run the same shutdown. |
| Engine crashes while running | Watchdog polls the child and shows an error dialog with the exit code and log tail. |
| `kill -9 <pid>` | **Engine survives.** `SIGKILL` cannot be intercepted; the engine is in its own process group so it outlives the shell. Clean it up with `kill -INT -<pgid>`. |

Sheep never kills anything by port. Port selection only *probes*; the only
signal ever sent is to the process group (Unix) or Job Object (Windows) that
Sheep itself created.

## Engine setup (project-local)

The shell refuses to use Python from outside the project. Create the engine
environment inside the repository:

```sh
cd /Volumes/TheEstrogenInjector/sheep/sheep
uv venv --python 3.13 portable_env
uv pip install --python portable_env/bin/python3 -r requirements/full/requirements_apple_silicon.txt
uv pip install --python portable_env/bin/python3 torch
```

`portable_env/` is gitignored. Once it exists, `cargo run` finds it
automatically and passes `--portable` to the engine.

Put GGUF models in `user_data/models/`. For a quick smoke test:

```sh
curl -L -o user_data/models/qwen2.5-0.5b-instruct-q4_k_m.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
```

## Run it

```sh
cd src-tauri
cargo run
```

Requirements for the real engine: Python **3.13** with the TextGen
requirements installed (see the repository README / `requirements/full/`).
On this project, the intended layout is a `portable_env/` in the repository
root, which the shell detects automatically.

### Run against the stub engine (no Python deps required)

```sh
src-tauri/dev/run-stub.sh
```

The stub prints the readiness line, serves a test page, and reports the
webview's User-Agent and IPC status back to stdout. This is the fastest way to
verify spawn → ready → navigate → shutdown. The runner opts into the system
interpreter explicitly; the packaged app never does.

## Interpreter safety rule

Sheep only runs Python that lives **inside the project**:

1. `portable_env/` in the project root (preferred), or
2. `SHEEP_PYTHON` pointing inside the project.

Anything outside is refused with an explanatory error. `SHEEP_ALLOW_EXTERNAL_PYTHON=1`
overrides this for deliberate developer workflows (the stub runner sets it).
There is no silent `PATH` fallback, so an unrelated personal TextGen install
cannot be picked up by accident.

## Environment variables

| Variable | Purpose |
|---|---|
| `SHEEP_APP_DIR` | Directory containing `server.py`. Defaults to the repo root in debug builds, or next to the executable. |
| `SHEEP_PYTHON` | Interpreter to use. Must be inside the project. Otherwise `portable_env/` is checked. |
| `SHEEP_ALLOW_EXTERNAL_PYTHON` | Set to `1` to allow an interpreter outside the project (developer / stub use only). |
| `SHEEP_SERVER` | Path to an alternative `server.py` (used by the stub). |
| `SHEEP_SMOKE_TEST_MS` | Test-only. Exit via `app.exit(0)` after N milliseconds. |
| `SHEEP_SMOKE_CLOSE_MS` | Test-only. Close the real window after N milliseconds (exercises the UI quit path). |

## CLI passthrough

Mirrors `desktop/textgen.sh` / `textgen.bat`:

```sh
cargo run -- --help            # python server.py --help
cargo run -- --nowebui         # engine only, no window
cargo run -- --listen          # engine only, bound to the network
cargo run -- --no-electron     # engine only (legacy alias)
cargo run -- --listen-port 9000
```

Any other flags are forwarded to `server.py`.

## Layout

```
src-tauri/
├── src/
│   ├── main.rs      # window, readiness loop, watchdog, shutdown
│   ├── engine.rs    # spawn, port scan, log capture, process-tree kill
│   ├── paths.rs     # app dir / python / server.py discovery
│   ├── bridge.rs    # electronAPI shim + IPC commands
│   ├── menu.rs      # macOS menu bar
│   └── args.rs      # launcher flag passthrough
├── shell/           # splash + failure screen (frontendDist)
├── capabilities/    # window permissions, incl. the 127.0.0.1 origins
├── permissions/     # app-command ACL entries for the bridge
├── icons/           # app icon (RGBA PNG + ICO)
└── dev/stub_server.py
```

## Platform status

| Platform | Status |
|---|---|
| macOS arm64 | **Primary target.** Built and smoke-tested end to end. Intel Macs are not supported. |
| Windows x64 | Compiles (`cargo check --target x86_64-pc-windows-msvc`). Uses WebView2 and a Job Object for process-tree cleanup. Not yet run on hardware. |
| Linux x64 | Not validated. Requires WebKitGTK 4.1 and `libayatana-appindicator` at build time; expect Gradio compatibility issues in WebKitGTK. |

## Deliberately not implemented yet

- Settings panel, profiles, or any config file writing. (Planned rewrite; do not
  add a `user_data`/CMD_FLAGS editor here.)
- Integrated PTY console — engine output currently goes to the terminal and
  `cache/sheep-shell.log`. The console tab will consume the same `push_line`
  seam in `engine.rs`.
- Bundling a Python runtime; the shell expects one to exist.
