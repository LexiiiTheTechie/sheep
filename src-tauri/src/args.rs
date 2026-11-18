/// Command-line passthrough, mirroring the behaviour of the old
/// `desktop/textgen.sh` / `textgen.bat` launchers.
///
/// - `--help` / `-h`      → print `server.py --help` and exit.
/// - `--nowebui` / `--listen` / `--no-electron`
///                        → run the engine in the terminal, no window.
/// - anything else        → open the desktop window and forward the flags.
pub struct LaunchOptions {
    pub help: bool,
    pub server_only: bool,
    pub rest: Vec<String>,
}

pub fn parse() -> LaunchOptions {
    // macOS may inject a process serial number argument when launched via
    // Finder / `open`; it is not meaningful to us.
    let rest: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with("-psn_"))
        .collect();

    let help = rest.iter().any(|arg| arg == "--help" || arg == "-h");
    let server_only = rest
        .iter()
        .any(|arg| arg == "--nowebui" || arg == "--listen" || arg == "--no-electron");

    LaunchOptions {
        help,
        server_only,
        rest,
    }
}
