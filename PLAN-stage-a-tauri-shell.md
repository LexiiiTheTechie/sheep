# Stage A: Replace the Electron shell with Tauri

**Project:** Sheep (`LexiiiTheTechie/sheep`)
**Scope:** Replace the Electron desktop wrapper (`desktop/main.js` + bundled Electron runtime) with a Tauri v2 shell. Python keeps serving Gradio. This is *not* a rewrite of the WebUI in Rust — that is the eventual Sheep native UI and a separate project.

**Why first:** it de-risks the assumption Sheep depends on — whether a Tauri webview renders this app correctly on macOS, Windows, and Linux — in a week rather than at month four. The resulting `src-tauri/src/engine.rs` supervisor is reusable for Sheep Phase 1.

---

## 0. Implementation status (as built)

The shell exists and runs. This section is the truth; the rest of the document is the original plan and is kept for context.

| Area | Status |
|---|---|
| A1 spike (webview renders Gradio) | **Done on macOS.** Gradio 4.37 UI loads and runs in WKWebView. |
| A2 supervisor | **Done.** Spawn, port selection, readiness, log capture, process-group shutdown, splash + failure screen, plus `SIGTERM`/`SIGINT`/`SIGHUP` cleanup. Verified: window close kills the engine and `llama-server` with no orphans. |
| A3 parity | Mostly done: `electronAPI.pickDirectory` bridge, window state, external-link routing, single-instance, macOS Edit menu. Waived: spellcheck suggestions, custom context menu. |
| A4 cross-OS | Windows type-checks (`cargo check --target x86_64-pc-windows-msvc`); not run on hardware. Linux unverified. |
| CI / portable packaging | Not started. `.github/workflows/build-portable-release.yml` still bundles Electron. |

**Verified end to end on macOS arm64:** Tauri → project-local Python 3.13 engine → `llama-server` → tokens, with a real GGUF (Qwen2.5-0.5B Q4_K_M) loaded in-app and served on `127.0.0.1:7861`.

### Deviations from the plan, and why

1. **Port selection instead of stdout regex only.** The shell picks a free UI port in `7860–7879`, falling back to an OS-assigned port, and passes `--listen-port`. It never displaces a process that owns a port. Readiness still accepts the `Running on local URL:` line and an HTTP 200.
2. **API port must be chosen too.** TextGen's internal `llama-server` binds `api_port + 5`, and upstream's availability check (`modules/llama_cpp_server.py`, `_is_port_available`) uses `SO_REUSEADDR`, which on macOS reports a live loopback listener as free. Sheep therefore verifies that *both* `p` and `p+5` can be bound simultaneously before passing `--api-port p`. Without this, the engine starts but the model fails to load with `couldn't bind HTTP server socket`.
3. **No `window.rs`.** Window lifecycle lives in `main.rs`; a separate module was not worth the indirection.
4. **Interpreter containment.** The shell refuses any Python outside the project root. Only `portable_env/` or an in-project `SHEEP_PYTHON` is accepted; `SHEEP_ALLOW_EXTERNAL_PYTHON=1` is the explicit developer escape hatch. This is a safety rule, not a packaging decision — it prevents picking up an unrelated personal TextGen install.
5. **`TEXTGEN_ELECTRON=1` retained**, as planned, so upstream's model-dir and spellcheck UI work with no Python diff.

### Confirmed Tauri v2 requirement

Custom commands invoked from a **remote** origin (`http://127.0.0.1:7860`…) need both:
- a capability whose `remote.urls` includes the origin, and
- an app-level permission entry (`permissions/sheep.toml` → `allow-<command>`).

Missing either fails at runtime with `ping not allowed. Plugin not found`, which reads like a missing plugin and is not obvious. Upstream Python is unmodified; the shim and the ACL are entirely on the Rust side.

---

## 1. What the Electron shell does today

`desktop/main.js` is a thin process host, which is why this is tractable.

| Feature | Electron implementation | Tauri replacement |
|---|---|---|
| Spawn engine | `spawn(python, ["server.py","--portable","--api",...args])`, `detached: !isWin`, env `TEXTGEN_ELECTRON=1` | same, via `std::process::Command` + process group / Job Object |
| Discover port | regex `Running on local URL:` from stdout | parse stdout **and** explicit `--listen-port <free>` |
| Readiness | raw TCP connect, 120 s timeout | HTTP GET `/` poll, 120 s (kills the white-flash-on-connect bug) |
| Window | `BrowserWindow`, loads `http://127.0.0.1:port` | `WebviewWindowBuilder` + `WebviewUrl::External` |
| Window state | hand-rolled `cache/window-state.json` | `tauri-plugin-window-state` |
| Kill tree | Unix `kill(-pid)`; Windows `taskkill /T /F` | Unix process group; **Windows Job Object** (strictly better than `/T`) |
| External links | `setWindowOpenHandler` → `shell.openExternal` | navigation/new-window handlers → `tauri-plugin-opener` |
| Folder picker | `preload.js` → `ipcMain` → `dialog` | remote-scoped IPC command (**the one hard part**, §3b) |
| Spellcheck | Chromium spellchecker + custom context menu with suggestions | `document.body.spellcheck` partial; suggestions unavailable |
| User data redirection | `app.setPath("userData", …/cache/electron)` | `WEBVIEW2_USER_DATA_FOLDER` / data directory per platform |
| Context menu (cut/copy/paste) | custom menu | **not provided** by Tauri; needs a small JS shim |
| CLI passthrough | `--help`, `--nowebui`, `--listen`, `--no-electron` handled in `textgen.sh/.bat` | same logic in Rust, before window creation |
| Linux flags | `--no-sandbox --no-zygote` | not needed (no Chromium sandbox) — problem disappears |

Upstream Python gates the Electron-only UI on `TEXTGEN_ELECTRON=1`:

- `modules/shared.py:43` — `is_electron = os.environ.get('TEXTGEN_ELECTRON') == '1'`
- `modules/ui_session.py:64-110` — model dir textbox, Browse button, spellcheck checkbox
- `js/main.js:892` — spellcheck toggle
- `modules/ui.py:251,521` — adds `model_dir` / `spellcheck` to change elements

**Keep setting that env var in Stage A.** You get model-dir + spellcheck UI with zero Python diff. Rename to `TEXTGEN_SHEEP` later when `is_sheep` becomes a real concept.

---

## 2. Target layout

```
sheep/
├── engine/                     # (upstream move happens later; not needed for Stage A)
├── src-tauri/                  # ← new, survives into Sheep
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/shell.json
│   ├── shell/index.html        # native splash: logo + "Starting engine…" + log tail
│   └── src/
│       ├── main.rs             # entry, subsystem=windows in release
│       ├── args.rs             # --help/--nowebui/--listen/--no-electron/--
│       ├── engine.rs           # spawn, port, readiness, shutdown
│       ├── window.rs           # window lifecycle, navigation policy
│       └── bridge.rs           # pick_directory (remote-scoped)
├── desktop/                    # deleted after cutover (git history keeps it)
└── shell -> src-tauri/target/release/sheep   (dev convenience)
```

Use `src-tauri/` now rather than a throwaway folder, so Sheep inherits it. Tauri does not require SvelteKit: point `build.frontendDist` at `src-tauri/shell` and navigate that window to the engine URL once ready (or build the real window and close the splash).

### Config sketch

```jsonc
{
  "productName": "Sheep",
  "identifier": "tech.lexiii.sheep",
  "build": { "frontendDist": "shell" },
  "app": {
    "withGlobalTauri": true,
    "windows": [{ "label": "main", "width": 1400, "height": 900, "titleBarStyle": "Overlay" }],
    "security": {
      "capabilities": ["shell"],
      "csp": null
    }
  }
}
```

### Startup sequence (Rust)

```
args::parse() ──┬── --help / --nowebui / --listen / --no-electron → hand off to python & exit
                │
                ├── pick free port (probe, don't assume 7860)
                │     → spawn: python server.py --portable --api --listen-port P
                │       env: TEXTGEN_ELECTRON=1, PYTHONUNBUFFERED=1, FORCE_COLOR=1,
                │            TERM=xterm-256color, PYTHONNOUSERSITE=1,
                │            PYTHONPATH/PYTHONHOME unset, CREATE_NO_WINDOW (win)
                │       stdout/stderr → ring buffer + cache/sheep.log
                │
                ├── await readiness:
                │     parse "Running on local URL:" AND HTTP 200 on /
                │     120 s deadline → on timeout show error window with last 200 log lines
                │
                └── navigate main window → http://127.0.0.1:P ; close splash

quit path: SIGINT → wait 8 s → SIGKILL (pgid)   |   Windows: close Job Object
```

---

## 3. Where parity genuinely breaks — be honest about these

### a) Webview engine ≠ Chromium

Gradio 4.37 is developed against Chrome. Three engines now: WKWebView (macOS), WebView2/Chromium (Windows), WebKitGTK (Linux). Expect breakage in drag-and-drop files, clipboard image paste, `showSaveFilePicker`, range sliders, and SSE streaming.

**macOS and Windows are low risk; WebKitGTK is the wildcard.** This is the single reason to do Stage A first — you get the answer cheaply.

Contingency if WebKitGTK fails: detect a Chrome/Edge/Chromium binary and launch `--app=http://127.0.0.1:P --window-size=…` as a frameless kiosk, or ship a `.deb` that depends on `chromium`. Ugly, but bounded. Also worth testing Gradio in plain Safari on macOS as a 10-minute sanity check — same engine.

### b) The folder picker

`window.electronAPI.pickDirectory()` is called from Gradio's own JS (`modules/ui_session.py:110`), so the page must be able to reach Rust. Tauri v2 supports this, but only deliberately:

- capability scoped to `"remote": { "urls": ["http://127.0.0.1:*"] }`
- an `initialization_script` that defines `window.electronAPI = { pickDirectory: () => __TAURI_INTERNALS__.invoke("pick_directory") }`
- a single command that opens the native dialog and returns a path

Two mitigations to include: bind the server to loopback only, and pass a per-launch nonce so only *your* server instance is trusted.

**Fallback that costs nothing:** extend the existing `is_electron` branch in `ui_session.py` so the model-dir field is a plain textbox when the bridge is absent. Browse becomes optional, nothing breaks.

### c) Spellcheck suggestions / context menu

WKWebView cannot expose dictionary suggestions; Tauri has no default right-click menu. Plan: keep the spellcheck checkbox wired to `document.body.spellcheck`, drop the suggestions popup, and inject a minimal cut/copy/paste context menu. Mark both as **partial parity, accepted**.

### d) File downloads

Need Tauri's download handler or Gradio downloads silently fail. Electron got this for free.

### e) macOS ATS

Plain-HTTP `127.0.0.1` needs `NSAllowsLocalNetworking: true` in the Info.plist, or the window loads blank. Easy to miss, costs an afternoon.

### f) Portable-release packaging

`.github/workflows/build-portable-release.yml:174-211` downloads Electron (~150 MB) and rewrites `desktop/textgen.sh|bat` via `__APP__` / `__ELECTRON__` substitution.

Replacement: a `shell` build job per platform (requires Rust on the runner), artifact copied into `textgen-VERSION/`, launcher script execs `Sheep.app/Contents/MacOS/sheep` or `sheep.exe`.

Note: a *portable* macOS `.app` is unsigned → Gatekeeper quarantine. The Electron zip had the same problem, but verify you don't regress the current UX.

### g) Size / RAM win

~10–15 MB binary vs ~150 MB Electron; ~80–120 MB RSS vs ~250–350 MB. Real, measurable, and worth putting in the README.

---

## 4. Execution plan

| Step | Work | Exit criteria | Est. |
|---|---|---|---|
| **A1 — spike** | Bare Tauri window loading a running `server.py` on macOS. Test Safari-engine compat: chat, streaming, drag-drop, sliders, file inputs. | Chat streams, no console errors, model loads | 1–2 d |
| **A2 — supervisor** | `args.rs` + `engine.rs`: spawn, free-port pick, readiness poll, log capture, process-group/Job Object shutdown, crash dialog with log tail. Splash window. | 20× start/stop cycles, zero orphan PIDs, no white flash, `--help`/`--nowebui` passthrough intact | 2–3 d |
| **A3 — parity** | Window state, navigation policy (external links out), download handler, context menu shim, `electronAPI` bridge + scoped capability, ATS plist, single-instance. | Feature table in §1 all ✔ or explicitly waived | 2–3 d |
| **A4 — cross-OS** | Windows: no console, WebView2 data dir, Job Object. Linux: WebKitGTK compat, `.deb` deps. CI job + portable layout rewrite. | Clean install on macOS arm64, Windows 11, Ubuntu 24.04 | 5–8 d |

**~2–3 weeks** to a shippable cutover; **~3–5 days** for a working macOS build first (recommended: A1–A3 on mac, then port).

**Definition of done:** `desktop/` deleted, no Electron dependency anywhere in the repo or release artifacts, `start_macos.sh` / `start_windows.bat` / `start_linux.sh` unchanged behavior, one binary launches the full WebUI.

---

## 5. Why this isn't throwaway

`src-tauri/src/engine.rs` **is** Sheep's Phase 1 supervisor. When you later add `--nowebui --api` mode and the native settings UI, you keep the same spawn/port/readiness/shutdown core and swap the webview target from `http://127.0.0.1:7860` to `tauri://localhost`. The Electron removal is permanent either way.

The one thing to resist: don't let this shell grow settings screens or Flock logic. Gradio stays the UI until it is deliberately replaced, otherwise you end up maintaining two frontends.

---

## 6. Decisions before starting

1. **Bridge approach:** scoped remote-IPC for `pickDirectory` (recommended) vs. `is_sheep` server-side textbox fallback with no IPC at all (safest, loses the Browse button)?
2. **Scope of first PR:** macOS-only dev build first (recommended), or all three OSes + CI rewrite in one go?
3. **Cutover style:** keep `desktop/` alongside the Tauri shell behind a flag, or hard-cut and delete immediately?
4. **Name / branding:** window title "Sheep" now, or keep "TextGen" until the native UI lands? Affects `identifier`, app-data paths, and signing identity — cheaper to decide before A4.
