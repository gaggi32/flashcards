//! Flashcards: tray, global hotkey, the two windows, and every command the UI
//! may call. The UI is local-only; nothing here loads remote content.

mod ai;
mod db;
mod settings;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Map, Value as Json};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, State, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use settings::{LocalPrefs, Settings, StudyPref};

const MAIN: &str = "main";
const OVERLAY: &str = "overlay";
/// Passed to ourselves by the login item, so a login start stays in the tray.
const AUTOSTART_FLAG: &str = "--hidden";
const DOWNLOAD_PAGE: &str = "https://github.com/gaggi32/flashcards/releases/latest";
const LATEST_RELEASE: &str = "https://api.github.com/repos/gaggi32/flashcards/releases/latest";
/// Hosts a link in the UI may open in the default browser. Everything else is
/// refused, and the webviews themselves never navigate away from the app.
const LINK_HOSTS: &[&str] = &["openrouter.ai", "github.com"];
/// This app's identifier, and the one versions up to 0.1.6 had (their data
/// folders are named after it).
const IDENTIFIER: &str = "com.gaggi32.flashcards";
const OLD_IDENTIFIER: &str = "ch.404canvas.flashcards";
const MAX_IMPORT_BYTES: u64 = 50 * 1024 * 1024;

struct AppState {
    settings: Mutex<Settings>,
    /// Whether the overlay is meant to be up (it can still be visible while
    /// it plays its exit), and a counter that tells one open or close from
    /// the next.
    overlay_open: AtomicBool,
    overlay_gen: AtomicU64,
    /// When the overlay was last opened, so a focus blip right after it
    /// appears isn't taken for a click elsewhere (see [`OVERLAY_BLUR_GRACE`]).
    overlay_opened_at: Mutex<Option<Instant>>,
    /// The overlay page's height and the zoom it is shown at.
    overlay_geom: Mutex<OverlayGeom>,
    hide_on_blur: AtomicBool,
    topmost_watch: Arc<AtomicBool>,
    http: reqwest::Client,
}

// ---- windows ----------------------------------------------------------------

/// WebView2 options for every window, the same for all of them: they share one
/// WebView2 environment, which refuses windows asking for different options.
/// wry's defaults, plus WebView2's occlusion throttling turned off: a panel
/// shown over the main window was taken for covered and froze on the first
/// frame of its entrance. Hidden windows are still throttled. Unused off
/// Windows.
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows";

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
        .additional_browser_args(BROWSER_ARGS)
        .on_navigation(|url| is_app_url(url))
        // No popups: window.open and target=_blank open nothing.
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
}

fn build_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay.html".into()))
        .title("Flashcards overlay")
        .inner_size(OVERLAY_W, OVERLAY_H)
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
        .additional_browser_args(BROWSER_ARGS)
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

// ---- the overlay's size ------------------------------------------------------
//
// The page is laid out OVERLAY_W CSS px wide and tells Rust how tall its
// content is (overlay_fit). The window is that content times a zoom that
// follows the screen it opens on, so the panel takes about the same share of
// a laptop and of a big monitor, and it is never shorter than its content:
// when the content would not fit the screen at that zoom, the zoom gives way.
// The webview is zoomed by the same factor, so text, buttons and the card all
// grow together.

/// The overlay page's width in CSS px (the panel plus the 6 px round it).
const OVERLAY_W: f64 = 470.0;
/// Its height until the page has measured itself.
const OVERLAY_H: f64 = 360.0;
/// Usable screen height (logical px) at which the overlay is shown at 1:1.
const OVERLAY_BASE_SCREEN_H: f64 = 820.0;
/// Share of the usable screen the overlay may take at most.
const OVERLAY_MAX_SHARE: f64 = 0.9;
/// Below this the text gets too small to read; past it the panel scrolls.
const OVERLAY_MIN_ZOOM: f64 = 0.7;

#[derive(Debug, Clone, Copy)]
struct OverlayGeom {
    /// The page's content height in CSS px.
    content_h: f64,
    /// The zoom the webview was last set to.
    zoom: f64,
}

/// Settings > overlay size, as a factor on the screen's own zoom.
fn size_factor(size: &str) -> f64 {
    match size {
        "small" => 0.85,
        "large" => 1.2,
        _ => 1.0,
    }
}

/// Zoom and logical window size for content `content_h` CSS px tall on a
/// usable screen area of `area_w` x `area_h` logical px.
fn overlay_layout(area_w: f64, area_h: f64, factor: f64, content_h: f64) -> (f64, f64, f64) {
    let auto = (area_h / OVERLAY_BASE_SCREEN_H).clamp(1.0, 1.5);
    let fits = (area_h * OVERLAY_MAX_SHARE / content_h).min(area_w * OVERLAY_MAX_SHARE / OVERLAY_W);
    let zoom = (auto * factor).min(fits).max(OVERLAY_MIN_ZOOM);
    // Two decimals, so a pixel more of content does not re-zoom the page.
    let zoom = (zoom * 100.0).floor() / 100.0;
    (zoom, OVERLAY_W * zoom, (content_h * zoom).min(area_h))
}

fn monitor_under_cursor(app: &AppHandle) -> Option<Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
}

/// Size the overlay for its content on the screen it is on, or, with
/// `place`, move it to the screen under the mouse and centre it there. Without
/// `place` the top edge stays where it is (the header never jumps) unless
/// the window would run off the bottom of the screen.
fn fit_overlay(app: &AppHandle, win: &WebviewWindow, place: bool) {
    let monitor = if place { monitor_under_cursor(app) } else { None }
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let state = app.state::<AppState>();
    let factor = size_factor(&state.settings.lock().unwrap().overlay_size);
    let work = m.work_area();
    let scale = m.scale_factor();
    let (ax, ay) = (work.position.x, work.position.y);
    let (aw, ah) = (work.size.width as i32, work.size.height as i32);

    let mut geom = state.overlay_geom.lock().unwrap();
    let (zoom, w, h) = overlay_layout(aw as f64 / scale, ah as f64 / scale, factor, geom.content_h);
    if place {
        // Onto that screen first: a screen with another scale factor rescales
        // the window as it arrives, and the size below must come after that.
        let _ = win.set_position(PhysicalPosition::new(ax, ay));
    }
    if (zoom - geom.zoom).abs() > f64::EPSILON {
        if win.set_zoom(zoom).is_ok() {
            geom.zoom = zoom;
        }
    }
    drop(geom);
    // Rounded up, so the page is never a fraction of a pixel short.
    let (pw, ph) = ((w * scale).round() as i32, (h * scale).ceil() as i32);
    let _ = win.set_size(PhysicalSize::new(pw as u32, ph as u32));

    let (x, y) = if place {
        // A little above centre reads as "in front of you" rather than "in the way".
        (ax + (aw - pw) / 2, ay + (ah - ph) * 2 / 5)
    } else {
        let Ok(at) = win.outer_position() else { return };
        (at.x, at.y.min(ay + ah - ph).max(ay))
    };
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

// The overlay animates in and out in the page. Closing tells the page to
// play its exit, and the window is hidden only once the panel is gone, so
// the frame the next show starts from is empty: a window shown with its old
// frame, then animated from nothing, is what flickered.

/// Longest the page may take to answer "overlay-close" before the window is
/// hidden anyway.
const OVERLAY_CLOSE_GRACE: Duration = Duration::from_millis(600);

/// How long after opening a lost focus doesn't count as a click elsewhere.
/// Windows can hand focus back for a moment just after the overlay appears
/// (a fullscreen game taking it back, WebView2 settling), and hiding on that
/// played the exit where the user had asked for the overlay.
const OVERLAY_BLUR_GRACE: Duration = Duration::from_millis(400);

fn open_overlay(app: &AppHandle) {
    let Some(win) = app.get_webview_window(OVERLAY) else { return };
    let state = app.state::<AppState>();
    let gen = state.overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
    state.overlay_open.store(true, Ordering::SeqCst);
    *state.overlay_opened_at.lock().unwrap() = Some(Instant::now());
    // Still visible means it is mid-exit: turn it around where it stands.
    if !win.is_visible().unwrap_or(false) {
        fit_overlay(app, &win, true);
        let _ = win.show();
        // Once more now it is shown: a hidden window can take a new screen's
        // scale factor only as it appears. The panel is not drawn yet.
        fit_overlay(app, &win, true);
    }
    let _ = win.set_focus();
    let _ = win.emit("overlay-open", gen);
}

fn close_overlay(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.overlay_open.swap(false, Ordering::SeqCst) {
        return;
    }
    let gen = state.overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(win) = app.get_webview_window(OVERLAY) else { return };
    let _ = win.emit("overlay-close", gen);
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(OVERLAY_CLOSE_GRACE);
        finish_close(&app, gen);
    });
}

/// Hide the window, unless the overlay was opened again since close `gen`.
fn finish_close(app: &AppHandle, gen: u64) {
    let state = app.state::<AppState>();
    if state.overlay_gen.load(Ordering::SeqCst) == gen && !state.overlay_open.load(Ordering::SeqCst) {
        if let Some(win) = app.get_webview_window(OVERLAY) {
            let _ = win.hide();
        }
    }
}

/// The hotkey: close the overlay only when it is up and in front. Up but not
/// focused (behind a fullscreen app, or focus went elsewhere) brings it
/// forward instead, so the press the user meant as "show it" never closes it.
fn toggle_overlay(app: &AppHandle) {
    let in_front = app
        .get_webview_window(OVERLAY)
        .is_some_and(|w| w.is_focused().unwrap_or(false));
    if app.state::<AppState>().overlay_open.load(Ordering::SeqCst) && in_front {
        close_overlay(app);
    } else {
        open_overlay(app);
    }
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

/// A set's file name for dragging out: what the page suggests, kept to safe
/// characters, always ending in `.json`.
fn drag_file_name(suggested: &str) -> String {
    let stem: String = suggested
        .trim_end_matches(".json")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_ ".contains(*c))
        .take(80)
        .collect();
    let stem = stem.trim();
    format!("{}.json", if stem.is_empty() { "set" } else { stem })
}

/// Drag one set out of the window as a file: onto the desktop, into a folder,
/// into a mail. The page sends the set's export and a name; Rust writes it to
/// its own cache folder and starts the OS drag from there, so the UI never
/// names a path. Resolves when the drag ends: true when it was dropped
/// somewhere (inside this window too: folder rows take it as a move).
#[tauri::command]
async fn drag_set_out(
    app: AppHandle,
    window: WebviewWindow,
    contents: String,
    suggested_name: String,
) -> Result<bool, String> {
    main_only(&window)?;
    if contents.len() as u64 > MAX_IMPORT_BYTES {
        return Err("That set is too big to drag out.".into());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("drag-out");
    // Files from earlier drags: whatever they were dropped on has copied them.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(drag_file_name(&suggested_name));
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    start_native_drag(&window, path).await
}

#[cfg(any(windows, target_os = "macos"))]
async fn start_native_drag(window: &WebviewWindow, path: PathBuf) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    let target = window.clone();
    // The OS drag has to start on the main thread, while the button is held.
    window
        .run_on_main_thread(move || {
            let tx = Mutex::new(Some(tx));
            let icon = drag::Image::Raw(include_bytes!("../icons/128x128.png").to_vec());
            let started = drag::start_drag(
                &target,
                drag::DragItem::Files(vec![path]),
                icon,
                move |result, _| {
                    if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                        let _ = tx.send(matches!(result, drag::DragResult::Dropped));
                    }
                },
                drag::Options::default(),
            );
            if let Err(e) = started {
                eprintln!("drag out failed to start: {e}");
            }
        })
        .map_err(|e| e.to_string())?;
    // Windows returns once the drop is done, macOS calls back later; either way
    // the answer comes through the channel (or the sender is dropped on failure).
    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "Could not start the drag.".to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
async fn start_native_drag(_window: &WebviewWindow, _path: PathBuf) -> Result<bool, String> {
    Err("Dragging a set out is not available on this system.".into())
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

// ---- the old data folders --------------------------------------------------

/// The folder name an earlier version used for `identifier`, or None if this
/// build has nothing to take over. A debug build only ever takes over a dev
/// folder (com.gaggi32.flashcards.dev from ch.404canvas.flashcards.dev), never
/// the installed app's real one.
fn old_folder_name(identifier: &str) -> Option<String> {
    let suffix = identifier.strip_prefix(IDENTIFIER)?;
    if cfg!(debug_assertions) && suffix.is_empty() {
        return None;
    }
    Some(format!("{OLD_IDENTIFIER}{suffix}"))
}

/// Move `old` to `new` unless `new` already holds something. The two sit side
/// by side, so this is a rename, not a copy.
fn take_over(old: &std::path::Path, new: &std::path::Path) -> std::io::Result<bool> {
    if !old.is_dir() {
        return Ok(false);
    }
    if new.exists() {
        if std::fs::read_dir(new)?.next().is_some() {
            return Ok(false);
        }
        std::fs::remove_dir(new)?;
    }
    std::fs::rename(old, new)?;
    Ok(true)
}

/// Versions up to 0.1.6 kept the database, settings and backups, and the
/// webview's storage (sessions in progress), in folders named after the old
/// identifier. Runs before anything opens them.
fn adopt_old_folders(app: &AppHandle) {
    let identifier = app.config().identifier.clone();
    let Some(old) = old_folder_name(&identifier) else { return };
    let path = app.path();
    #[allow(unused_mut)]
    let mut dirs = vec![path.app_data_dir(), path.app_local_data_dir()];
    #[cfg(target_os = "macos")]
    dirs.push(path.home_dir().map(|h| h.join("Library/WebKit").join(&identifier)));
    for new in dirs.into_iter().flatten() {
        let Some(parent) = new.parent() else { continue };
        if let Err(e) = take_over(&parent.join(&old), &new) {
            eprintln!("could not move {old} to {}: {e}", new.display());
        }
    }
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
    let mut next = settings.sanitized();
    let prev = state.settings.lock().unwrap().clone();
    // Only set_autostart and the study commands below change these, so a
    // stale copy in the UI can't.
    next.keep_own_fields(&prev);
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
    let resize = next.overlay_size != prev.overlay_size;
    *state.settings.lock().unwrap() = next.clone();
    if resize {
        if let Some(win) = app.get_webview_window(OVERLAY) {
            if win.is_visible().unwrap_or(false) {
                fit_overlay(&app, &win, false);
            }
        }
    }
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

/// Start with the computer: changes the login item and remembers the choice,
/// so launch can put it back if an installer removes it. Returns the OS state.
#[tauri::command]
fn set_autostart(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    on: bool,
) -> Result<bool, String> {
    main_only(&window)?;
    set_login_item(&app, on)?;
    let next = {
        let mut current = state.settings.lock().unwrap();
        current.autostart = Some(on);
        current.clone()
    };
    settings::store(&app, &next)?;
    let _ = app.emit("settings-changed", &next);
    Ok(app.autolaunch().is_enabled().unwrap_or(on))
}

/// A choice made in a study screen: the overlay's set or mode, the
/// special-keys switch, the side Flashcards shows first. Both windows have
/// those screens, so this one is open to the overlay; `StudyPref` can name
/// nothing else.
#[tauri::command]
fn set_study_pref(app: AppHandle, state: State<'_, AppState>, pref: StudyPref) -> Result<Settings, String> {
    let next = state.settings.lock().unwrap().clone().with(pref);
    settings::store(&app, &next)?;
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

/// The study choices versions up to 0.1.14 kept in localStorage, handed over
/// by the main window on its first start with this version (see
/// `Settings::adopt`).
#[tauri::command]
fn adopt_local_prefs(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    prefs: LocalPrefs,
) -> Result<Settings, String> {
    main_only(&window)?;
    let prev = state.settings.lock().unwrap().clone();
    let next = prev.clone().adopt(prefs);
    if next != prev {
        settings::store(&app, &next)?;
        *state.settings.lock().unwrap() = next.clone();
        let _ = app.emit("settings-changed", &next);
    }
    Ok(next)
}

/// The study sessions versions up to 0.1.14 kept in localStorage are in the
/// database now: the UI never imports them again. Either window may be the
/// one that carried them over (whichever loaded a session first).
#[tauri::command]
fn mark_sessions_carried_over(app: AppHandle, state: State<'_, AppState>) -> Result<Settings, String> {
    let prev = state.settings.lock().unwrap().clone();
    if prev.sessions_carried_over {
        return Ok(prev);
    }
    let next = Settings { sessions_carried_over: true, ..prev };
    settings::store(&app, &next)?;
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
    /// The release's notes: its CHANGELOG section, as the release job writes it.
    notes: Option<String>,
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u64>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/// The version in a GitHub release answer ("tag_name": "v1.2.3" gives "1.2.3").
fn release_version(body: &Json) -> Option<String> {
    let tag = body.get("tag_name")?.as_str()?.trim();
    let v = tag.strip_prefix('v').unwrap_or(tag);
    (v.len() <= 20 && parse_version(v).is_some()).then(|| v.to_string())
}

/// Ask GitHub for the newest published release of this app. Only its version
/// is read; installing is always the user's own download.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let http = app.state::<AppState>().http.clone();
    let res = http
        .get(LATEST_RELEASE)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Could not reach GitHub".to_string())?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("GitHub shows no public release yet".into());
    }
    if !res.status().is_success() {
        return Err(format!("GitHub answered {}", res.status()));
    }
    let body: Json = res.json().await.map_err(|_| "Unexpected answer".to_string())?;
    let latest = release_version(&body);
    let newer = match (&latest, parse_version(&current)) {
        (Some(l), Some(c)) => parse_version(l).map_or(false, |l| l > c),
        _ => false,
    };
    let notes = body
        .get("body")
        .and_then(Json::as_str)
        .map(|b| b.chars().take(8000).collect::<String>())
        .filter(|b| !b.trim().is_empty());
    Ok(UpdateInfo { current, latest, newer, notes })
}

/// Download the newest release, check its signature against the key built
/// into this app (tauri.conf.json, plugins.updater.pubkey), install it and
/// restart. The installer comes from the app, not a browser, so Windows does
/// not ask about it the way it does a download; the signature is what makes
/// that safe: anything not signed with the release key is refused. Progress
/// goes out as "update-progress" (0-100, or -1 while the size is unknown).
#[tauri::command]
async fn install_update(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Could not check for the update: {e}"))?
        .ok_or("There is no newer version to install.")?;
    let mut done: usize = 0;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk;
                let pct = total.map_or(-1, |t| if t == 0 { -1 } else { (done as u64 * 100 / t) as i64 });
                let _ = progress.emit("update-progress", pct);
            },
            || {},
        )
        .await
        .map_err(|e| format!("Could not install the update: {e}"))?;
    app.restart();
}

/// The main window showed "What's new" up to `version` (or it was the first
/// start): remember it, so the card shows only what comes after.
#[tauri::command]
fn mark_version_seen(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>, version: String) -> Result<Settings, String> {
    main_only(&window)?;
    if !settings::is_version(&version) {
        return Err("Not a version".into());
    }
    let prev = state.settings.lock().unwrap().clone();
    if prev.last_seen_version == version {
        return Ok(prev);
    }
    let next = Settings { last_seen_version: version, ..prev };
    settings::store(&app, &next)?;
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("settings-changed", &next);
    Ok(next)
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
    if !app.state::<AppState>().overlay_open.load(Ordering::SeqCst) {
        open_overlay(&app);
    }
}

#[tauri::command]
fn hide_overlay(app: AppHandle) {
    close_overlay(&app);
}

/// The page finished the exit of close `gen`.
#[tauri::command]
fn overlay_closed(app: AppHandle, gen: u64) {
    finish_close(&app, gen);
}

/// The overlay page's content is `height` CSS px tall: size the window to it.
#[tauri::command]
fn overlay_fit(app: AppHandle, window: WebviewWindow, height: f64) -> Result<(), String> {
    if window.label() != OVERLAY {
        return Err("only the overlay sizes itself".into());
    }
    if !height.is_finite() {
        return Ok(());
    }
    app.state::<AppState>().overlay_geom.lock().unwrap().content_h = height.clamp(120.0, 4000.0);
    if window.is_visible().unwrap_or(false) {
        fit_overlay(&app, &window, false);
    }
    Ok(())
}

/// For a page that loads after the hotkey: is the overlay up, and since when.
#[tauri::command]
fn overlay_state(state: State<'_, AppState>) -> (bool, u64) {
    (
        state.overlay_open.load(Ordering::SeqCst),
        state.overlay_gen.load(Ordering::SeqCst),
    )
}

#[tauri::command]
fn open_main(app: AppHandle, route: Option<String>) {
    match route {
        Some(r) if r.starts_with('/') && r.len() < 200 => navigate_main(&app, &r),
        _ => show_main(&app),
    }
    close_overlay(&app);
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

// ---- start with the computer ----------------------------------------------

/// Whether the app's login item exists at all, on or off. Windows keeps "off
/// in Task Manager" apart from "not there"; elsewhere they are the same.
#[cfg(windows)]
fn login_item_registered(app: &AppHandle, _on: bool) -> bool {
    windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .and_then(|key| key.get_string(&app.package_info().name))
        .is_ok()
}

#[cfg(not(windows))]
fn login_item_registered(_app: &AppHandle, on: bool) -> bool {
    on
}

fn set_login_item(app: &AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let done = if on { launcher.enable() } else { launcher.disable() };
    done.map_err(|e| format!("Could not change the login item: {e}"))
}

/// At launch: put the login item back if an installer removed it, and point
/// it at this executable. Returns what the stored choice should now be.
fn sync_login_item(app: &AppHandle, stored: Option<bool>) -> bool {
    let on = app.autolaunch().is_enabled().unwrap_or(false);
    // The entry is named after the product, not the identifier, so a dev
    // build would re-point the installed app's entry at itself.
    if cfg!(debug_assertions) {
        return stored.unwrap_or(on);
    }
    let want = settings::autostart_wanted(stored, on, login_item_registered(app, on));
    if want {
        // Also re-points an entry left at an older executable.
        if let Err(e) = set_login_item(app, true) {
            eprintln!("{e}");
        }
    }
    want
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(ai::KeyCache(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_batch,
            backup_now,
            export_file,
            import_file,
            drag_set_out,
            open_data_folder,
            get_settings,
            save_settings,
            set_autostart,
            set_study_pref,
            adopt_local_prefs,
            mark_sessions_carried_over,
            suspend_hotkey,
            resume_hotkey,
            app_info,
            open_link,
            open_download_page,
            check_update,
            install_update,
            mark_version_seen,
            set_tray_status,
            show_overlay,
            hide_overlay,
            overlay_closed,
            overlay_fit,
            overlay_state,
            open_main,
            ai_key_status,
            ai_set_key,
            ai_clear_key,
            ai_request
        ])
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == OVERLAY => {
                let state = window.state::<AppState>();
                if !state.hide_on_blur.load(Ordering::Relaxed) {
                    return;
                }
                let just_opened = state
                    .overlay_opened_at
                    .lock()
                    .unwrap()
                    .is_some_and(|t| t.elapsed() < OVERLAY_BLUR_GRACE);
                if just_opened {
                    // A blip, not a click elsewhere: take the focus back.
                    let _ = window.set_focus();
                } else {
                    close_overlay(window.app_handle());
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

            adopt_old_folders(&handle);
            let data_dir = app.path().app_data_dir()?;
            let conn = db::open(&db::path_in(&data_dir)).map_err(|e| format!("database: {e}"))?;
            app.manage(db::Db(Arc::new(Mutex::new(conn))));

            let mut prefs = settings::load(&handle);
            let want = sync_login_item(&handle, prefs.autostart);
            if prefs.autostart != Some(want) {
                prefs.autostart = Some(want);
                let _ = settings::store(&handle, &prefs);
            }
            let topmost = Arc::new(AtomicBool::new(prefs.overlay_topmost_watch));
            app.manage(AppState {
                hide_on_blur: AtomicBool::new(prefs.overlay_hide_on_blur),
                topmost_watch: topmost.clone(),
                settings: Mutex::new(prefs.clone()),
                overlay_open: AtomicBool::new(false),
                overlay_gen: AtomicU64::new(0),
                overlay_opened_at: Mutex::new(None),
                overlay_geom: Mutex::new(OverlayGeom { content_h: OVERLAY_H, zoom: 1.0 }),
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
    fn a_dragged_set_gets_a_safe_json_name() {
        assert_eq!(drag_file_name("german-verbs.json"), "german-verbs.json");
        assert_eq!(drag_file_name(r"../../evil\x.json"), "evilx.json");
        assert_eq!(drag_file_name("C:/Windows/system32"), "CWindowssystem32.json");
        assert_eq!(drag_file_name(""), "set.json");
        assert_eq!(drag_file_name("..."), "set.json");
        assert_eq!(drag_file_name(&"a".repeat(200)).len(), 85);
    }

    #[test]
    fn the_overlay_grows_with_the_screen() {
        // A laptop at 150 % (1280 x 800 logical, taskbar off): 1:1.
        let (z, w, h) = overlay_layout(1280.0, 752.0, 1.0, 300.0);
        assert_eq!((z, w, h), (1.0, 470.0, 300.0));
        // A 24" 1080p screen at 100 %: about a quarter bigger.
        let (z, w, _) = overlay_layout(1920.0, 1032.0, 1.0, 300.0);
        assert_eq!(z, 1.25);
        assert_eq!(w, 587.5);
        // Never more than 1.5 on its own.
        assert_eq!(overlay_layout(3840.0, 2100.0, 1.0, 300.0).0, 1.5);
        // The size setting scales on top of that.
        assert_eq!(overlay_layout(1920.0, 1032.0, size_factor("large"), 300.0).0, 1.51);
        assert_eq!(overlay_layout(1280.0, 752.0, size_factor("small"), 300.0).0, 0.85);
    }

    #[test]
    fn the_overlay_is_never_shorter_than_its_content() {
        // Fits: the window is exactly the content.
        let (z, _, h) = overlay_layout(1920.0, 1032.0, 1.2, 500.0);
        assert!(h >= 500.0 * z - 0.001 && h <= 1032.0 * OVERLAY_MAX_SHARE);
        // Too tall for the screen at that zoom: the zoom gives way, all of it shows.
        let (z, _, h) = overlay_layout(1280.0, 720.0, 1.0, 700.0);
        assert!(z < 1.0);
        assert!((h - 700.0 * z).abs() < 0.001 && h <= 720.0 * OVERLAY_MAX_SHARE);
        // A narrow screen holds the width back too.
        let (_, w, _) = overlay_layout(500.0, 900.0, 1.0, 300.0);
        assert!(w <= 450.0);
        // Absurdly tall content: the zoom stops at the floor and the window at the screen.
        let (z, _, h) = overlay_layout(1280.0, 752.0, 1.0, 4000.0);
        assert_eq!(z, OVERLAY_MIN_ZOOM);
        assert_eq!(h, 752.0);
    }

    #[test]
    fn old_folders_map_to_the_new_ones() {
        assert_eq!(old_folder_name("com.gaggi32.flashcards.dev").as_deref(), Some("ch.404canvas.flashcards.dev"));
        assert_eq!(old_folder_name("something.else"), None);
        // Tests are debug builds: the real folder is left alone.
        assert_eq!(old_folder_name("com.gaggi32.flashcards"), None);
    }

    #[test]
    fn take_over_moves_once_and_never_overwrites() {
        let root = std::env::temp_dir().join(format!("fc-takeover-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (old, new) = (root.join("old"), root.join("new"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("flashcards.db"), b"cards").unwrap();
        std::fs::create_dir_all(&new).unwrap(); // an empty folder may be replaced
        assert!(take_over(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("flashcards.db")).unwrap(), b"cards");
        assert!(!old.exists());
        assert!(!take_over(&old, &new).unwrap());
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("flashcards.db"), b"stale").unwrap();
        assert!(!take_over(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("flashcards.db")).unwrap(), b"cards");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn release_version_reads_the_tag() {
        assert_eq!(release_version(&serde_json::json!({"tag_name": "v0.2.0"})).as_deref(), Some("0.2.0"));
        assert_eq!(release_version(&serde_json::json!({"tag_name": "0.2.0"})).as_deref(), Some("0.2.0"));
        assert_eq!(release_version(&serde_json::json!({"tag_name": "nightly"})), None);
        assert_eq!(release_version(&serde_json::json!({})), None);
    }

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
