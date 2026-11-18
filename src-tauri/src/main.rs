#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod args;
mod bridge;
mod engine;
mod menu;
mod paths;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const STARTUP_TIMEOUT_SECS: u64 = 180;

/// The single running engine, reachable from paths that do not have an
/// `AppHandle` (notably the Unix signal handler).
static ENGINE: std::sync::OnceLock<Arc<engine::Engine>> = std::sync::OnceLock::new();

fn main() {
    let options = args::parse();

    if options.help {
        std::process::exit(run_headless(&options.rest, true));
    }
    if options.server_only {
        std::process::exit(run_headless(&options.rest, false));
    }

    run_gui(options.rest);
}

/// Legacy launcher behaviour: `--help` and `--nowebui` / `--listen` /
/// `--no-electron` run the engine directly in the terminal.
fn run_headless(args: &[String], help: bool) -> i32 {
    let base = paths::base_dir();
    let python = match paths::python(&base) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let server = match paths::server_script(&base) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };

    let mut command = std::process::Command::new(python);
    command.arg(server).current_dir(&base);
    if !help {
        command.arg("--api");
        if base.join("portable_env").exists() {
            command.arg("--portable");
        }
    }
    command.args(args);

    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("Failed to launch the engine: {error}");
            1
        }
    }
}

fn run_gui(rest: Vec<String>) {
    let mut builder = tauri::Builder::default();

    // Smoke tests must not be swallowed by an already-running window.
    if std::env::var_os("SHEEP_SMOKE_TEST_MS").is_none()
        && std::env::var_os("SHEEP_SMOKE_CLOSE_MS").is_none()
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            bridge::ping,
            bridge::pick_directory,
            bridge::open_external
        ])
        .setup(move |app| {
            menu::install(app)?;

            // Hidden CI/smoke hook: start the app, let it boot the engine, then
            // exit through the normal shutdown path. Never set in normal use.
            if let Ok(value) = std::env::var("SHEEP_SMOKE_TEST_MS") {
                if let Ok(millis) = value.parse::<u64>() {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(millis));
                        eprintln!("[sheep] smoke test: requesting exit");
                        handle.exit(0);
                    });
                }
            }

            // Exercises the real window-close path (rather than app.exit).
            if let Ok(value) = std::env::var("SHEEP_SMOKE_CLOSE_MS") {
                if let Ok(millis) = value.parse::<u64>() {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(millis));
                        eprintln!("[sheep] smoke test: closing window");
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.close();
                        }
                    });
                }
            }

            let nav_handle = app.handle().clone();
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Sheep")
                    .inner_size(1400.0, 900.0)
                    .min_inner_size(900.0, 600.0)
                    .initialization_script(bridge::INIT_SCRIPT)
                    .on_navigation(move |url| {
                        if url.scheme() == "tauri" {
                            return true;
                        }

                        if matches!(url.host_str(), Some("127.0.0.1") | Some("localhost")) {
                            return true;
                        }

                        if matches!(url.scheme(), "http" | "https") {
                            let app = nav_handle.clone();
                            let target = url.to_string();
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_opener::OpenerExt;
                                let _ = app.opener().open_url(target, None::<&str>);
                            });
                        }

                        false
                    })
                    .build()?;

            let base = paths::base_dir();
            match engine::Engine::start(&base, &rest) {
                Ok(started) => {
                    let engine = started.engine.clone();
                    app.manage(engine.clone());
                    let _ = ENGINE.set(engine.clone());
                    install_signal_cleanup();

                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        wait_then_open(handle, engine, started.port, started.log_path);
                    });
                }
                Err(error) => show_failure(&window, &error),
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Sheep application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } => {
                eprintln!("[sheep] event: ExitRequested");
                if let Some(engine) = app.try_state::<Arc<engine::Engine>>() {
                    engine.stop();
                }
            }
            RunEvent::Exit => {
                eprintln!("[sheep] event: Exit");
                if let Some(engine) = app.try_state::<Arc<engine::Engine>>() {
                    engine.stop();
                }
            }
            RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                eprintln!("[sheep] event: WindowDestroyed");
                app.exit(0);
            }
            _ => {}
        });
}

/// Install Unix signal handlers so `SIGTERM` / `SIGINT` / `SIGHUP` also stop
/// the engine.
///
/// The window-close path already stops the engine, but the app can be killed
/// from outside (`Ctrl+C`, `kill`, a supervisor). The engine runs in its own
/// process group so it can be killed as a tree, which also means those signals
/// never reach it — without this handler an external `SIGTERM` orphans the
/// engine and `llama-server`.
///
/// The handler only writes one byte to a pipe (`write` is async-signal-safe).
/// A dedicated thread performs the actual shutdown.
///
/// `SIGKILL` cannot be handled; a `kill -9` of the shell will still orphan the
/// engine. Nothing in-process can prevent that.
#[cfg(unix)]
fn install_signal_cleanup() {
    use std::sync::atomic::{AtomicI32, Ordering};

    static WRITE_FD: AtomicI32 = AtomicI32::new(-1);

    extern "C" fn on_signal(_signal: libc::c_int) {
        let fd = WRITE_FD.load(Ordering::SeqCst);
        if fd >= 0 {
            let byte = 1u8;
            unsafe {
                libc::write(fd, &byte as *const u8 as *const libc::c_void, 1);
            }
        }
    }

    let mut fds = [0i32; 2];
    let (read_fd, write_fd) = unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return;
        }
        let pair = (fds[0], fds[1]);
        // Cast through an explicit function pointer: casting a function *item*
        // straight to an integer is deprecated.
        let handler = on_signal as extern "C" fn(libc::c_int);
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::signal(signal, handler as usize as libc::sighandler_t);
        }
        pair
    };

    WRITE_FD.store(write_fd, Ordering::SeqCst);

    std::thread::spawn(move || {
        let mut byte = 0u8;
        loop {
            let read = unsafe { libc::read(read_fd, &mut byte as *mut u8 as *mut libc::c_void, 1) };
            if read > 0 {
                break;
            }
            let interrupted =
                std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted;
            if read == 0 || !interrupted {
                return;
            }
        }

        eprintln!("[sheep] signal received: stopping engine");
        if let Some(engine) = ENGINE.get() {
            engine.stop();
        }
        std::process::exit(0);
    });
}

#[cfg(not(unix))]
fn install_signal_cleanup() {}

fn wait_then_open(
    app: tauri::AppHandle,
    engine: Arc<engine::Engine>,
    port: u16,
    log_path: PathBuf,
) {
    let deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECS);

    loop {
        if engine.is_ready() || engine::http_probe(port) {
            break;
        }

        if let Some(code) = engine.poll_exit() {
            let message = format!(
                "The engine exited before it was ready (exit code {}).\n\n{}",
                code.map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".into()),
                tail_for_display(&engine, &log_path)
            );
            show_failure_on(app.get_webview_window("main"), &message);
            return;
        }

        if Instant::now() >= deadline {
            let message = format!(
                "Timed out after {STARTUP_TIMEOUT_SECS}s waiting for the engine on 127.0.0.1:{port}.\n\n{}",
                tail_for_display(&engine, &log_path)
            );
            show_failure_on(app.get_webview_window("main"), &message);
            return;
        }

        std::thread::sleep(Duration::from_millis(250));
    }

    if let Some(window) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{port}/");
        match tauri::Url::parse(&url) {
            Ok(parsed) => {
                let _ = window.set_title("Sheep");
                let _ = window.navigate(parsed);
            }
            Err(error) => {
                show_failure(&window, &format!("Invalid engine URL {url}: {error}"));
                return;
            }
        }
    }

    // Stay alive as a watchdog: if the engine dies after the UI is up, the
    // webview would otherwise sit on a dead page.
    loop {
        std::thread::sleep(Duration::from_millis(1000));
        if let Some(code) = engine.poll_exit() {
            let message = format!(
                "The engine stopped unexpectedly (exit code {}).\n\nLog: {}\n\n{}",
                code.map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".into()),
                log_path.display(),
                engine.log_tail(20)
            );
            let _ = app
                .dialog()
                .message(message)
                .title("Sheep")
                .kind(MessageDialogKind::Error)
                .blocking_show();
            app.exit(1);
            return;
        }
    }
}

fn tail_for_display(engine: &engine::Engine, log_path: &std::path::Path) -> String {
    let tail = engine.log_tail(40);
    if tail.trim().is_empty() {
        format!(
            "No engine output was captured.\nLog file: {}",
            log_path.display()
        )
    } else {
        format!(
            "Last engine output:\n{}\n\nFull log: {}",
            tail,
            log_path.display()
        )
    }
}

fn show_failure_on(window: Option<WebviewWindow>, message: &str) {
    match window {
        Some(window) => show_failure(&window, message),
        None => eprintln!("{message}"),
    }
}

fn show_failure(window: &WebviewWindow, message: &str) {
    let encoded = serde_json::to_string(message).unwrap_or_else(|_| "\"unknown error\"".into());
    let script = format!("window.sheepFail && window.sheepFail({encoded});");
    let _ = window.eval(&script);
}
