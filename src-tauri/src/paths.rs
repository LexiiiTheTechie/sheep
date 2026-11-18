use std::path::{Path, PathBuf};

/// Resolve the application root: the directory that contains `server.py`.
///
/// Order of precedence:
/// 1. `SHEEP_APP_DIR` environment override.
/// 2. In debug builds, the repository root (parent of `src-tauri`).
/// 3. Next to the executable, `../Resources` (macOS bundle), or three levels up.
/// 4. The current working directory.
pub fn base_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("SHEEP_APP_DIR") {
        return PathBuf::from(dir);
    }

    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        if dev.join("server.py").exists() {
            return dev.canonicalize().unwrap_or(dev);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
        let candidates = [
            dir.clone(),
            dir.join("..").join("Resources"),
            dir.join("..").join("..").join(".."),
        ];
        for candidate in candidates {
            if candidate.join("server.py").exists() {
                return candidate.canonicalize().unwrap_or(candidate);
            }
        }
        return dir;
    }

    std::env::current_dir().unwrap_or_default()
}

pub fn server_script(base: &Path) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("SHEEP_SERVER") {
        let path = PathBuf::from(raw);
        if !path.exists() {
            return Err(format!(
                "SHEEP_SERVER points to a file that does not exist: {}",
                path.display()
            ));
        }
        ensure_inside_project(&path, base, "server script")?;
        return Ok(path);
    }

    let path = base.join("server.py");
    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "Could not find server.py in {}.\n\nSet SHEEP_APP_DIR to the directory that contains server.py.",
            base.display()
        ))
    }
}

/// Find a Python interpreter.
///
/// Safety rule: Sheep only runs interpreters that live inside the project.
/// The bundled `portable_env/` is preferred. `SHEEP_PYTHON` is accepted only
/// when it points inside the project, or when
/// `SHEEP_ALLOW_EXTERNAL_PYTHON=1` is set explicitly. The system `PATH` is not
/// searched otherwise, so an unrelated personal TextGen installation can never
/// be picked up by accident.
pub fn python(base: &Path) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("SHEEP_PYTHON") {
        let path = PathBuf::from(raw);
        if !path.is_file() {
            return Err(format!(
                "SHEEP_PYTHON points to a file that does not exist: {}",
                path.display()
            ));
        }
        ensure_inside_project(&path, base, "Python interpreter")?;
        return Ok(path);
    }

    let env_dir = base.join("portable_env");
    let bundled = [
        env_dir.join("bin").join("python3"),
        env_dir.join("bin").join("python"),
        env_dir.join("python.exe"),
    ];
    for candidate in bundled {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if external_allowed() {
        for name in ["python3.13", "python3.12", "python3", "python"] {
            if let Some(path) = find_in_path(name) {
                return Ok(path);
            }
        }
    }

    Err(format!(
        "No Python interpreter found inside the project.\n\n\
         Sheep only runs interpreters under {} (normally portable_env/).\n\n\
         Create one with:\n  \
         uv venv --python 3.13 portable_env\n  \
         uv pip install --python portable_env/bin/python3 -r requirements/full/requirements_apple_silicon.txt\n\n\
         Set SHEEP_ALLOW_EXTERNAL_PYTHON=1 only if you deliberately want to use \
         an interpreter outside the project.",
        base.display()
    ))
}

fn external_allowed() -> bool {
    matches!(
        std::env::var("SHEEP_ALLOW_EXTERNAL_PYTHON").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

/// Reject any interpreter or script that resolves outside the project root.
/// The final path component is not dereferenced, so a venv symlink inside
/// `portable_env/` that points at a managed interpreter elsewhere is still
/// considered part of the project.
fn ensure_inside_project(path: &Path, base: &Path, what: &str) -> Result<(), String> {
    if is_within(path, base) || external_allowed() {
        return Ok(());
    }

    Err(format!(
        "Refusing to use a {what} outside the project:\n  {}\n\n\
         Sheep stays inside {}.\n\
         If this is intentional, set SHEEP_ALLOW_EXTERNAL_PYTHON=1.",
        path.display(),
        base.display()
    ))
}

fn is_within(path: &Path, root: &Path) -> bool {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };

    let parent = absolute.parent().unwrap_or(&absolute);
    let resolved_parent = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    let resolved = resolved_parent.join(absolute.file_name().unwrap_or_default());

    let resolved_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    resolved.starts_with(resolved_root)
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{name}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::is_within;

    #[test]
    fn inside_root_is_allowed() {
        let root = std::env::current_dir().unwrap();
        assert!(is_within(&root.join("portable_env/bin/python3"), &root));
    }

    #[test]
    fn outside_root_is_rejected() {
        let root = std::env::current_dir().unwrap();
        assert!(!is_within(std::path::Path::new("/usr/bin/python3"), &root));
    }

    #[test]
    fn parent_traversal_is_rejected() {
        let root = std::env::current_dir().unwrap();
        assert!(!is_within(&root.join("../python3"), &root));
    }
}
