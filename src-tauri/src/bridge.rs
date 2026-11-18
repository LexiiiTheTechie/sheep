/// Injected into the webview before any page script runs.
///
/// The TextGen UI expects the Electron preload bridge (`window.electronAPI`)
/// for its "Browse" folder picker and spellcheck toggle. We provide the same
/// shape backed by Tauri IPC. If IPC is unavailable (for example because the
/// page origin is not covered by the capability file), the folder picker
/// resolves to `null` and the UI keeps its current value, exactly like the
/// Electron handler does when the dialog is cancelled.
pub const INIT_SCRIPT: &str = r#"
(function () {
  function invoke(cmd, args) {
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        return window.__TAURI__.core.invoke(cmd, args);
      }
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        return window.__TAURI_INTERNALS__.invoke(cmd, args);
      }
    } catch (error) {
      // fall through to the rejected promise below
    }
    return Promise.reject(new Error("Tauri IPC is not available"));
  }

  window.electronAPI = {
    pickDirectory: function () {
      return invoke("pick_directory", {}).catch(function () { return null; });
    }
  };

  // Gradio opens documentation and model links with target="_blank". Route
  // those to the system browser instead of spawning an unmanaged webview.
  var nativeOpen = window.open;
  window.open = function (url) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      invoke("open_external", { url: url }).catch(function () {});
      return null;
    }
    return nativeOpen ? nativeOpen.apply(window, arguments) : null;
  };

  // Guard against middle-click / ctrl-click new-tab navigation.
  document.addEventListener(
    "auxclick",
    function (event) {
      if (event.button !== 1) return;
      var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      var href = anchor.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        invoke("open_external", { url: href }).catch(function () {});
      }
    },
    true
  );
})();
"#;

#[tauri::command]
pub async fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) URLs may be opened externally".into());
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}
