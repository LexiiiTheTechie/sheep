#[cfg(target_os = "macos")]
use tauri::Manager;

/// Install a macOS menu bar. This is not cosmetic: without an Edit menu,
/// `Cmd+C` / `Cmd+V` are unreliable inside WKWebView.
#[cfg(target_os = "macos")]
pub fn install(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::AboutMetadata;
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let about = PredefinedMenuItem::about(
        app,
        Some("About Sheep"),
        Some(AboutMetadata::default()),
    )?;
    let services = PredefinedMenuItem::services(app, None)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;
    let quit = PredefinedMenuItem::quit(app, None)?;

    let app_menu = SubmenuBuilder::new(app, "Sheep")
        .item(&about)
        .separator()
        .item(&services)
        .separator()
        .item(&hide)
        .item(&hide_others)
        .item(&show_all)
        .separator()
        .item(&quit)
        .build()?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .build()?;

    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "View").item(&reload).build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "reload" {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("location.reload()");
            }
        }
    });

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &mut tauri::App) -> tauri::Result<()> {
    Ok(())
}
