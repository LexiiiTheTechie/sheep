use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::paths;

const LOG_CAPACITY: usize = 500;
const PREFERRED_PORT: u16 = 7860;
const PORT_SCAN_RANGE: u16 = 20;

pub struct Engine {
    inner: Mutex<Inner>,
    ready: AtomicBool,
}

struct Inner {
    child: Option<Child>,
    exited: bool,
    exit_code: Option<i32>,
    log: VecDeque<String>,
    #[cfg(windows)]
    job: isize,
}

pub struct Started {
    pub engine: Arc<Engine>,
    pub port: u16,
    pub log_path: PathBuf,
}

impl Engine {
    /// Spawn `server.py --api` and begin draining its output.
    ///
    /// This is intentionally the only place that knows how the engine process
    /// is created. A future settings/profile layer should feed this function
    /// structured arguments rather than shell strings; no config file is read
    /// here yet.
    pub fn start(base: &Path, user_args: &[String]) -> Result<Started, String> {
        let server = paths::server_script(base)?;
        let python = paths::python(base)?;
        let (port, inject_port) = resolve_port(user_args);
        let (api_port, inject_api_port) = resolve_api_port(user_args);

        let cache_dir = base.join("cache");
        let _ = fs::create_dir_all(&cache_dir);
        let log_path = cache_dir.join("sheep-shell.log");
        let mut log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();
        if let Some(file) = log_file.as_mut() {
            let _ = writeln!(
                file,
                "\n--- Sheep session started {} ---",
                timestamp()
            );
            let _ = writeln!(file, "python: {}", python.display());
            let _ = writeln!(file, "server: {}", server.display());
            if inject_api_port {
                let _ = writeln!(file, "api port: {api_port}");
            }
        }

        let engine = Arc::new(Engine {
            inner: Mutex::new(Inner {
                child: None,
                exited: false,
                exit_code: None,
                log: VecDeque::with_capacity(LOG_CAPACITY),
                #[cfg(windows)]
                job: 0,
            }),
            ready: AtomicBool::new(false),
        });

        let mut command = Command::new(&python);
        command.arg(&server).arg("--api");

        // Match the portable launcher when a bundled environment is present.
        if base.join("portable_env").exists() {
            command.arg("--portable");
        }
        if inject_port {
            command.arg("--listen-port").arg(port.to_string());
        }
        if inject_api_port {
            command.arg("--api-port").arg(api_port.to_string());
        }
        command.args(user_args);

        command
            .current_dir(base)
            .env("TEXTGEN_ELECTRON", "1")
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONNOUSERSITE", "1")
            .env("FORCE_COLOR", "1")
            .env("TERM", "xterm-256color")
            .env_remove("PYTHONPATH")
            .env_remove("PYTHONHOME")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Put the engine in its own process group so the whole tree
            // (python → llama-server) can be signalled at once.
            command.process_group(0);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|error| {
            format!(
                "Failed to launch the engine.\n\npython: {}\nserver: {}\n\n{}",
                python.display(),
                server.display(),
                error
            )
        })?;

        #[cfg(windows)]
        {
            let job = win_job::create();
            if job != 0 {
                win_job::assign(job, &child);
            }
            if let Ok(mut inner) = engine.inner.lock() {
                inner.job = job;
            }
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Ok(mut inner) = engine.inner.lock() {
            inner.child = Some(child);
        }

        let stdout_log = log_file.as_ref().and_then(|file| file.try_clone().ok());
        let stderr_log = log_file.as_ref().and_then(|file| file.try_clone().ok());

        if let Some(stdout) = stdout {
            spawn_reader(engine.clone(), stdout, port, stdout_log);
        }
        if let Some(stderr) = stderr {
            spawn_reader(engine.clone(), stderr, port, stderr_log);
        }

        Ok(Started {
            engine,
            port,
            log_path,
        })
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// Returns `None` while the process is alive, or `Some(exit_code)` after
    /// it has exited.
    pub fn poll_exit(&self) -> Option<Option<i32>> {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return Some(None),
        };

        if inner.exited {
            return Some(inner.exit_code);
        }

        if let Some(child) = inner.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    inner.exited = true;
                    inner.exit_code = status.code();
                    inner.child = None;
                    return Some(inner.exit_code);
                }
                Ok(None) => {}
                Err(_) => {
                    inner.exited = true;
                    inner.child = None;
                    return Some(None);
                }
            }
        }

        None
    }

    pub fn stop(&self) {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        let Some(mut child) = inner.child.take() else {
            return;
        };
        #[cfg(windows)]
        let job = inner.job;
        drop(inner);

        // Conservative safety check: if our direct child has already exited,
        // do not signal its PID again. We never signal by port, and we never
        // touch a process we did not spawn.
        #[cfg(unix)]
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }

        #[cfg(unix)]
        {
            let pid = child.id() as i32;
            // The engine was spawned with process_group(0), so its pgid is its pid.
            unsafe {
                libc::kill(-pid, libc::SIGINT);
            }

            for _ in 0..80 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }

            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            let _ = child.wait();
        }

        #[cfg(windows)]
        {
            if job != 0 {
                win_job::terminate(job);
            } else {
                let _ = child.kill();
            }
            let _ = child.wait();
            if job != 0 {
                win_job::close(job);
            }
        }

        #[cfg(not(any(unix, windows)))]
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn log_tail(&self, count: usize) -> String {
        let inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return String::new(),
        };
        let start = inner.log.len().saturating_sub(count);
        inner
            .log
            .iter()
            .skip(start)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn push_line(&self, line: String, port: u16) {
        if line.contains("Running on local URL")
            || line.contains(&format!("127.0.0.1:{port}"))
        {
            self.ready.store(true, Ordering::SeqCst);
        }

        if let Ok(mut inner) = self.inner.lock() {
            if inner.log.len() == LOG_CAPACITY {
                inner.log.pop_front();
            }
            inner.log.push_back(line.clone());
        }

        // The user asked for the console to stay visible during this stage of
        // the project. This is the seam where a PTY-backed console will later
        // take over instead of inheriting our stdout.
        eprintln!("[engine] {line}");
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

fn spawn_reader<R>(engine: Arc<Engine>, stream: R, port: u16, mut log_file: Option<File>)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(file) = log_file.as_mut() {
                let _ = writeln!(file, "{line}");
            }
            engine.push_line(line, port);
        }
    });
}

/// Choose the web UI port. If the user supplied `--listen-port`, respect it and
/// do not inject our own flag.
fn resolve_port(user_args: &[String]) -> (u16, bool) {
    let mut index = 0;
    while index < user_args.len() {
        let arg = &user_args[index];
        if arg == "--listen-port" {
            if let Some(value) = user_args.get(index + 1) {
                if let Ok(port) = value.parse::<u16>() {
                    return (port, false);
                }
            }
        }
        if let Some(value) = arg.strip_prefix("--listen-port=") {
            if let Ok(port) = value.parse::<u16>() {
                return (port, false);
            }
        }
        index += 1;
    }

    for offset in 0..PORT_SCAN_RANGE {
        let port = PREFERRED_PORT + offset;
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return (port, true);
        }
    }

    // Every preferred port is busy. Ask the OS for any free port instead of
    // failing or disturbing the process that owns the port.
    if let Ok(probe) = TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = probe.local_addr() {
            return (addr.port(), true);
        }
    }

    (PREFERRED_PORT, true)
}

/// Choose the public API port. TextGen's internal llama-server binds
/// `api_port + 5`, and its own availability check uses `SO_REUSEADDR`, which
/// on macOS can report a live `127.0.0.1` listener as free. So we verify that
/// both ports can actually be bound at the same time before handing the pair
/// to the engine. An explicit `--api-port` from the user wins.
fn resolve_api_port(user_args: &[String]) -> (u16, bool) {
    for arg in user_args {
        if arg == "--api-port" || arg.starts_with("--api-port=") {
            return (0, false);
        }
    }

    for range in [5000u16..5100, 6000..6100] {
        for port in range {
            if port_pair_available(port) {
                return (port, true);
            }
        }
    }

    (0, false)
}

fn port_pair_available(port: u16) -> bool {
    if port.checked_add(5).is_none() {
        return false;
    }

    // Both listeners are held until this function returns, so the check is
    // atomic with respect to other local processes.
    let first = TcpListener::bind(("127.0.0.1", port));
    let second = TcpListener::bind(("127.0.0.1", port + 5));
    matches!((first, second), (Ok(_), Ok(_)))
}

/// Cheap readiness probe used as a fallback when the engine's log line is
/// missed or buffered. Gradio answers `/` with 200 once it is serving.
pub fn http_probe(port: u16) -> bool {
    let addr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };

    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    if stream
        .write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut buffer = [0u8; 96];
    match stream.read(&mut buffer) {
        Ok(read) if read > 0 => {
            let head = String::from_utf8_lossy(&buffer[..read]);
            head.starts_with("HTTP/1.")
                && (head.contains(" 200") || head.contains(" 302") || head.contains(" 303"))
        }
        _ => false,
    }
}

fn timestamp() -> String {
    // Avoid a chrono dependency: seconds since the epoch is enough to locate a
    // session in the log file.
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => format!("{}", duration.as_secs()),
        Err(_) => "unknown".to_string(),
    }
}

#[cfg(windows)]
mod win_job {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub fn create() -> isize {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return 0;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return 0;
            }

            job as isize
        }
    }

    pub fn assign(job: isize, child: &Child) {
        unsafe {
            AssignProcessToJobObject(job as *mut c_void, child.as_raw_handle() as *mut c_void);
        }
    }

    pub fn terminate(job: isize) {
        unsafe {
            TerminateJobObject(job as *mut c_void, 0);
        }
    }

    pub fn close(job: isize) {
        unsafe {
            CloseHandle(job as *mut c_void);
        }
    }
}
