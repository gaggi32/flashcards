//! Flashcards: tray, global hotkey, the two windows, and every command the UI
//! may call. The UI is local-only; nothing here loads remote content.

mod ai;
mod db;
mod settings;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value as Json};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use settings::Settings;

const MAIN: &str = "main";
const OVERLAY: &str = "overlay";
/// Passed to ourselves by the login item, so a login start stays in the tray.
const AUTOSTART_FLAG: &str = "--hidden";
const DOWNLOAD_PAGE: &str = "https://404canvas.ch/projects/flashcards";
const VERSION_URL: &str = "https://404canvas.ch/api/flashcards-version";
/// Hosts a link in the UI may open in the default browser. Everything else is
/// refused, and the webviews themselves never navigate away from the app.
const LINK_HOSTS: &[&str] = &["openrouter.ai", "404canvas.ch", "www.404canvas.ch"];
const MAX_IMPORT_BYTES: u64 = 50 * 1024 * 1024;

struct AppState {
    settings: Mutex<Settings>,
    hide_on_blur: AtomicBool,
    topmost_watch: Arc<AtomicBool>,
    http: reqwest::Client,
}

// ---- windows ----------------------------------------------------------------

/// The app's own pages only. In dev that is the Vite server; in a build it is
/// Tauri's asset protocol (tauri://localhost on macOS, http(s)://tauri.localhost
/// on Windows).
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1430),
            _ => false,
        },
        _ => false,
    }
}

fn build_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Flashcards")
        .inner_size(1040.0, 760.0)
        .min_inner_size(520.0, 480.0)
        .center()
        .visible(false)
        .disable_drag_drop_handler()
        .on_navigation(|url| is_app_url(url))
        // No popups: window.open and target=_blank open nothing.
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
}

fn build_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay.html".into()))
        .title("Flashcards overlay")
        .inner_size(720.0, 600.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .disable_drag_drop_handler()
        .on_navigation(|url| is_app_url(url))
        // No popups: window.open and target=_blank open nothing.
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Centre the overlay on the monitor under the mouse, falling back to the
/// window's own monitor.
fn place_overlay(app: &AppHandle, win: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    let (Some(m), Ok(size)) = (monitor, win.outer_size()) else {
        let _ = win.center();
        return;
    };
    let (mp, ms) = (m.position(), m.size());
    let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
    // A little above centre reads as "in front of you" rather than "in the way".
    let y = mp.y + (ms.height as i32 - size.height as i32) * 2 / 5;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn toggle_overlay(app: &AppHandle) {
    let Some(win) = app.get_webview_window(OVERLAY) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    place_overlay(app, &win);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit("overlay-open", ());
}

fn spawn_topmost_watch(app: AppHandle, flag: Arc<AtomicBool>) {
    // Fullscreen apps take HWND_TOPMOST back when they regain focus; asserting
    // it on an interval brings the overlay back on top within a beat.
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(750));
        if flag.load(Ordering::Relaxed) {
            if let Some(win) = app.get_webview_window(OVERLAY) {
                if win.is_visible().unwrap_or(false) {
                    let _ = win.set_always_on_top(true);
                }
            }
        }
    });
}

// ---- tray -------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let study = MenuItem::with_id(app, "study", "Study now", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Flashcards", true, None::<&str>)?;
    let prefs = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&study, &open, &prefs, &sep, &quit])?;

    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().cloned().expect("bundle has an icon"))
        .tooltip("Flashcards")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "study" => toggle_overlay(app),
            "open" => show_main(app),
            "settings" => navigate_main(app, "/settings"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_overlay(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn navigate_main(app: &AppHandle, route: &str) {
    show_main(app);
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.emit("navigate", route);
    }
}

// ---- hotkey -----------------------------------------------------------------

fn register_hotkey(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.register(accelerator)
        .map_err(|e| format!("Could not use {accelerator}: {e}"))
}

/// Commands that touch files, settings or the API key answer the main window
/// only. The overlay needs none of them, so a page in it could not use them
/// even if it were somehow running someone else's script.
fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN {
        Ok(())
    } else {
        Err("Not available in this window.".into())
    }
}

// ---- commands: database -------------------------------------------------------

fn db_conn(app: &AppHandle) -> Arc<Mutex<rusqlite::Connection>> {
    app.state::<db::Db>().0.clone()
}

#[tauri::command]
async fn db_select(app: AppHandle, sql: String, params: Vec<Json>) -> Result<Vec<Map<String, Json>>, String> {
    let conn = db_conn(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database lock poisoned")?;
        db::select(&conn, &sql, &params)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn db_batch(app: AppHandle, statements: Vec<db::Stmt>) -> Result<Vec<db::ExecResult>, String> {
    let conn = db_conn(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = conn.lock().map_err(|_| "Database lock poisoned")?;
        db::batch(&mut conn, &statements)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("backups")).map_err(|e| e.to_string())
}

/// Snapshot the database into the backups folder and keep the newest `keep`.
/// `stamp` is YYYYMMDD-HHMMSS in the user's local time, from the UI.
#[tauri::command]
async fn backup_now(app: AppHandle, window: WebviewWindow, stamp: String) -> Result<String, String> {
    main_only(&window)?;
    let ok = stamp.len() == 15
        && stamp.as_bytes()[8] == b'-'
        && stamp.chars().enumerate().all(|(i, c)| i == 8 || c.is_ascii_digit());
    if !ok {
        return Err("Bad backup stamp".into());
    }
    let dir = backups_dir(&app)?;
    let keep = app.state::<AppState>().settings.lock().unwrap().backups_kept as usize;
    let conn = db_conn(&app);
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(format!("flashcards-{stamp}.db"));
        {
            let conn = conn.lock().map_err(|_| "Database lock poisoned")?;
            db::backup_to(&conn, &dest)?;
        }
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map_or(false, |n| n.starts_with("flashcards-") && n.ends_with(".db"))
            })
            .collect();
        files.sort();
        let excess = files.len().saturating_sub(keep);
        for old in files.into_iter().take(excess) {
            let _ = std::fs::remove_file(old);
        }
        Ok(dest.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- commands: files ----------------------------------------------------------

/// Save `contents` where the user picks in a native dialog. The UI never names
/// a path, so it cannot write anywhere the user did not choose.
#[tauri::command]
async fn export_file(
    app: AppHandle,
    window: WebviewWindow,
    contents: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    main_only(&window)?;
    let name: String = suggested_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ".contains(*c))
        .take(80)
        .collect();
    let name = if name.ends_with(".json") { name } else { format!("{name}.json") };
    let picked = app
        .dialog()
        .file()
        .add_filter("Flashcards export", &["json"])
        .set_file_name(&name)
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Read a file the user picks in a native dialog (JSON or plain text).
#[tauri::command]
async fn import_file(app: AppHandle, window: WebviewWindow, kind: String) -> Result<Option<String>, String> {
    main_only(&window)?;
    let (label, exts): (&str, &[&str]) = match kind.as_str() {
        "json" => ("Flashcards export", &["json"]),
        _ => ("Text", &["txt", "csv", "tsv", "md"]),
    };
    let picked = app.dialog().file().add_filter(label, exts).blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_IMPORT_BYTES {
        return Err("That file is over 50 MB.".into());
    }
    let raw = std::fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(raw).map(Some).map_err(|_| "That file is not UTF-8 text.".into())
}

#[tauri::command]
fn open_data_folder(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ---- commands: settings & system -------------------------------------------------

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    main_only(&window)?;
    let next = settings.sanitized();
    let prev = state.settings.lock().unwrap().clone();
    if next.hotkey != prev.hotkey {
        if let Err(e) = register_hotkey(&app, &next.hotkey) {
            // Put the old one back so the overlay stays reachable.
            let _ = register_hotkey(&app, &prev.hotkey);
            return Err(e);
        }
    }
    settings::store(&app, &next)?;
    state.hide_on_blur.store(next.overlay_hide_on_blur, Ordering::Relaxed);
    state.topmost_watch.store(next.overlay_topmost_watch, Ordering::Relaxed);
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

/// Release the hotkey while the Settings recorder listens for a new one.
#[tauri::command]
fn suspend_hotkey(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())
}

#[tauri::command]
fn resume_hotkey(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let hotkey = state.settings.lock().unwrap().hotkey.clone();
    register_hotkey(&app, &hotkey)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    platform: &'static str,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: app.path().app_data_dir().map(|d| d.display().to_string()).unwrap_or_default(),
        platform: if cfg!(target_os = "macos") { "macos" } else if cfg!(windows) { "windows" } else { "linux" },
    }
}

#[tauri::command]
fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Not a link".to_string())?;
    let host_ok = parsed.host_str().map_or(false, |h| LINK_HOSTS.contains(&h));
    if parsed.scheme() != "https" || !host_ok {
        return Err("That link is not on the allowed list.".into());
    }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_download_page(app: AppHandle) -> Result<(), String> {
    app.opener().open_url(DOWNLOAD_PAGE, None::<&str>).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current: String,
    latest: Option<String>,
    newer: bool,
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u64>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/// Ask the website for the newest version. Only a version number comes back;
/// installing is always the user's own download from the site.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let http = app.state::<AppState>().http.clone();
    let res = http
        .get(VERSION_URL)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Could not reach 404canvas.ch".to_string())?;
    if !res.status().is_success() {
        return Err(format!("404canvas.ch answered {}", res.status()));
    }
    let body: Json = res.json().await.map_err(|_| "Unexpected answer".to_string())?;
    let latest = body
        .get("version")
        .and_then(Json::as_str)
        .filter(|v| v.len() <= 20 && parse_version(v).is_some())
        .map(str::to_string);
    let newer = match (&latest, parse_version(&current)) {
        (Some(l), Some(c)) => parse_version(l).map_or(false, |l| l > c),
        _ => false,
    };
    Ok(UpdateInfo { current, latest, newer })
}

#[tauri::command]
fn set_tray_status(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("tray") {
        let text: String = text.chars().take(120).collect();
        let _ = tray.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn show_overlay(app: AppHandle) {
    let visible = app
        .get_webview_window(OVERLAY)
        .map_or(false, |w| w.is_visible().unwrap_or(false));
    if !visible {
        toggle_overlay(&app);
    }
}

#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if let Some(win) = app.get_webview_window(OVERLAY) {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_main(app: AppHandle, route: Option<String>) {
    match route {
        Some(r) if r.starts_with('/') && r.len() < 200 => navigate_main(&app, &r),
        _ => show_main(&app),
    }
    if let Some(win) = app.get_webview_window(OVERLAY) {
        let _ = win.hide();
    }
}

// ---- commands: AI -------------------------------------------------------------

#[tauri::command]
fn ai_key_status(cache: State<'_, ai::KeyCache>) -> ai::KeyStatus {
    ai::status(&cache)
}

#[tauri::command]
fn ai_set_key(window: WebviewWindow, cache: State<'_, ai::KeyCache>, key: String) -> Result<ai::KeyStatus, String> {
    main_only(&window)?;
    ai::save_key(&cache, &key)
}

#[tauri::command]
fn ai_clear_key(window: WebviewWindow, cache: State<'_, ai::KeyCache>) -> Result<ai::KeyStatus, String> {
    main_only(&window)?;
    ai::clear_key(&cache)
}

#[tauri::command]
async fn ai_request(
    app: AppHandle,
    window: WebviewWindow,
    endpoint: String,
    body: Option<Json>,
) -> Result<ai::Reply, String> {
    main_only(&window)?;
    let endpoint = ai::Endpoint::parse(&endpoint).ok_or("Unknown endpoint")?;
    let key = ai::read_key(&app.state::<ai::KeyCache>())
        .ok_or("No OpenRouter key yet. Add one in Settings.")?;
    let http = app.state::<AppState>().http.clone();
    ai::send(&http, &key, endpoint, body).await
}

// ---- run ----------------------------------------------------------------------

pub fn run() {
    let app = tauri::Builder::default()
        // single-instance must be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_overlay(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ai::KeyCache(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_batch,
            backup_now,
            export_file,
            import_file,
            open_data_folder,
            get_settings,
            save_settings,
            suspend_hotkey,
            resume_hotkey,
            app_info,
            open_link,
            open_download_page,
            check_update,
            set_tray_status,
            show_overlay,
            hide_overlay,
            open_main,
            ai_key_status,
            ai_set_key,
            ai_clear_key,
            ai_request
        ])
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == OVERLAY => {
                let state = window.state::<AppState>();
                if state.hide_on_blur.load(Ordering::Relaxed) {
                    let _ = window.hide();
                }
            }
            // Closing the main window keeps the app in the tray.
            WindowEvent::CloseRequested { api, .. } if window.label() == MAIN => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle().clone();

            let data_dir = app.path().app_data_dir()?;
            let conn = db::open(&db::path_in(&data_dir)).map_err(|e| format!("database: {e}"))?;
            app.manage(db::Db(Arc::new(Mutex::new(conn))));

            let prefs = settings::load(&handle);
            let topmost = Arc::new(AtomicBool::new(prefs.overlay_topmost_watch));
            app.manage(AppState {
                hide_on_blur: AtomicBool::new(prefs.overlay_hide_on_blur),
                topmost_watch: topmost.clone(),
                settings: Mutex::new(prefs.clone()),
                http: reqwest::Client::builder()
                    .user_agent(concat!("Flashcards/", env!("CARGO_PKG_VERSION")))
                    .https_only(true)
                    .build()?,
            });

            build_main(&handle)?;
            build_overlay(&handle)?;
            build_tray(&handle)?;
            spawn_topmost_watch(handle.clone(), topmost);

            if let Err(e) = register_hotkey(&handle, &prefs.hotkey) {
                eprintln!("{e}; falling back to {}", settings::DEFAULT_HOTKEY);
                let _ = register_hotkey(&handle, settings::DEFAULT_HOTKEY);
            }

            // Heal a login item left pointing at an older executable.
            let autostart = app.autolaunch();
            if autostart.is_enabled().unwrap_or(false) {
                let _ = autostart.enable();
            }

            if !std::env::args().any(|a| a == AUTOSTART_FLAG) {
                show_main(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Flashcards");

    app.run(|_app, _event| {
        // macOS: clicking the Dock icon with no window showing.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = _event {
            show_main(_app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_apps_own_pages_load() {
        assert!(is_app_url(&Url::parse("tauri://localhost/index.html").unwrap()));
        assert!(is_app_url(&Url::parse("http://tauri.localhost/overlay.html").unwrap()));
        assert!(!is_app_url(&Url::parse("https://evil.example/").unwrap()));
        assert!(!is_app_url(&Url::parse("file:///C:/Windows/win.ini").unwrap()));
        assert!(!is_app_url(&Url::parse("http://localhost:8080/").unwrap()));
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(parse_version("0.10.0") > parse_version("0.9.9"));
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2"), None);
    }
}
