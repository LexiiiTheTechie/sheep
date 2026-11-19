#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod args;
mod auth_commands;
mod bridge;
mod db;
mod engine;
mod menu;
mod paths;
mod slots;
mod web_server;

use std::net::SocketAddr;
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
    command.arg(server);
    if help {
        command.arg("--help");
    } else {
        command.args(args);
    }

    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("failed to run engine: {error}");
            1
        }
    }
}

fn run_gui(rest: Vec<String>) {
    let base_dir = paths::base_dir();
    let db_path = base_dir.join("user_data").join("sheep.db");
    let database = Arc::new(db::Database::new(db_path).expect("failed to initialize sheep SQLite database"));
    let initial_max_users = database.get_max_active_users().unwrap_or(3) as usize;
    let slot_manager = Arc::new(slots::SlotManager::new(initial_max_users));

    let app_state = auth_commands::AppState {
        db: database.clone(),
        slots: slot_manager.clone(),
    };

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        if std::env::var_os("SHEEP_SMOKE_TEST_MS").is_none()
            && std::env::var_os("SHEEP_SMOKE_CLOSE_MS").is_none()
        {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }));
        }
    }

    let web_db = database.clone();
    let web_slots = slot_manager.clone();
    let web_base_dir = base_dir.clone();

    builder
        .manage(app_state)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            bridge::ping,
            bridge::pick_directory,
            bridge::open_external,
            auth_commands::check_first_run,
            auth_commands::setup_owner,
            auth_commands::login,
            auth_commands::get_current_user,
            auth_commands::logout,
            auth_commands::get_user_sessions,
            auth_commands::revoke_session,
            auth_commands::update_password,
            auth_commands::delete_account,
            auth_commands::get_slot_status,
            auth_commands::claim_slot,
            auth_commands::release_slot,
            auth_commands::admin_force_release,
            auth_commands::set_max_active_users
        ])
        .setup(move |app| {
            menu::install(app)?;

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

                    let dist_dir = web_base_dir.join("ui").join("dist");
                    let server_ctx = web_server::ServerContext {
                        db: web_db,
                        slots: web_slots,
                        python_api_port: started.api_port,
                        dist_dir,
                    };

                    // Spawn Rust Axum Web Server on 0.0.0.0:7850 so both local and LAN webclients work without colliding with 7860!
                    std::thread::spawn(move || {
                        let rt = tokio::runtime::Runtime::new().expect("Failed to start Tokio runtime for Web server");
                        rt.block_on(async {
                            let addr: SocketAddr = "0.0.0.0:7850".parse().unwrap();
                            web_server::run_server(addr, server_ctx).await;
                        });
                    });

                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        wait_engine_ready(handle, engine, started.port, started.log_path);
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

fn wait_engine_ready(
    app: tauri::AppHandle,
    engine: Arc<engine::Engine>,
    port: u16,
    log_path: PathBuf,
) {
    let deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECS);

    loop {
        if engine.is_ready() || engine::http_probe(port) {
            eprintln!("[sheep] engine is ready on port {port}");
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

    watchdog(app, engine, log_path);
}

fn watchdog(app: tauri::AppHandle, engine: Arc<engine::Engine>, log_path: PathBuf) {
    loop {
        std::thread::sleep(Duration::from_millis(500));
        if let Some(code) = engine.poll_exit() {
            let message = format!(
                "The engine stopped unexpectedly (exit code {}).\n\n{}",
                code.map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".into()),
                tail_for_display(&engine, &log_path)
            );
            show_dialog_and_exit(app, &message);
            return;
        }
    }
}

fn tail_for_display(engine: &engine::Engine, log_path: &PathBuf) -> String {
    let tail = engine.log_tail(50);
    if tail.trim().is_empty() {
        format!("Log file: {}", log_path.display())
    } else {
        format!("Recent log output:\n{tail}\n\nFull log: {}", log_path.display())
    }
}

fn show_failure(window: &WebviewWindow, error: &str) {
    let escaped = serde_json::to_string(error).unwrap_or_else(|_| "\"Failed\"".into());
    let script = format!(
        "if (window.sheepFail) {{ window.sheepFail({escaped}); }} else {{ document.body.innerText = {escaped}; }}"
    );
    let _ = window.eval(&script);
}

fn show_failure_on(window: Option<WebviewWindow>, error: &str) {
    if let Some(window) = window {
        show_failure(&window, error);
    }
}

fn show_dialog_and_exit(app: tauri::AppHandle, message: &str) {
    let handle = app.clone();
    let text = message.to_string();
    app.dialog()
        .message(text)
        .title("Sheep Engine Error")
        .kind(MessageDialogKind::Error)
        .show(move |_| {
            handle.exit(1);
        });
}
