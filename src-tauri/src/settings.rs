//! Preferences, as one JSON file in the per-user app config directory.
//!
//! Every field has a default, so a file written by an older build still loads
//! once new fields appear. Values coming back from the UI are clamped in
//! [`Settings::sanitized`] before they are stored or acted on.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "settings.json";

/// ⌘⌥F on macOS, Ctrl+Alt+F elsewhere. Ctrl+Shift+F would steal "search in
/// files" from every editor, and Dash and Lingo already own Ctrl+Shift+Space/L.
pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Alt+F";
pub const DEFAULT_MODEL: &str = "google/gemini-3.8-flash";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    // --- overlay ---
    pub hotkey: String,
    /// Cards per overlay round; 0 means every card in the set.
    pub overlay_round: u32,
    /// New (never studied) cards mixed into a round once due cards run out.
    pub overlay_new_cards: u32,
    /// "term" | "definition" | "mixed": which side the overlay shows first.
    pub overlay_front: String,
    pub overlay_hide_on_blur: bool,
    pub overlay_topmost_watch: bool,
    // --- reminders ---
    pub reminders: bool,
    /// "HH:MM", local time.
    pub reminder_time: String,
    // --- look ---
    /// "system" | "light" | "dark"
    pub theme: String,
    pub eye_comfort: bool,
    // --- data ---
    pub auto_backup: bool,
    pub backups_kept: u32,
    // --- AI ---
    pub ai_model: String,
    // --- system ---
    pub check_updates: bool,
    /// Start with the computer. Kept here as well as in the OS, because
    /// installing a new version by hand runs the old uninstaller, and that
    /// deletes the login item; at launch the app puts it back. None until the
    /// app has first seen what the OS has (files from before this field).
    pub autostart: Option<bool>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: DEFAULT_HOTKEY.into(),
            overlay_round: 10,
            overlay_new_cards: 5,
            overlay_front: "term".into(),
            overlay_hide_on_blur: true,
            overlay_topmost_watch: false,
            reminders: false,
            reminder_time: "18:00".into(),
            theme: "system".into(),
            eye_comfort: false,
            auto_backup: true,
            backups_kept: 14,
            ai_model: DEFAULT_MODEL.into(),
            check_updates: true,
            autostart: None,
        }
    }
}

fn one_of(value: &str, allowed: &[&str], fallback: &str) -> String {
    if allowed.contains(&value) { value.into() } else { fallback.into() }
}

fn valid_time(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u8>().map_or(false, |h| h < 24)
        && t[3..].parse::<u8>().map_or(false, |m| m < 60)
}

/// A global hotkey without a modifier would fire on every press of that key in
/// every app, so one is required.
pub fn has_modifier(accelerator: &str) -> bool {
    let parts: Vec<&str> = accelerator.split('+').map(str::trim).collect();
    parts.len() >= 2
        && parts[..parts.len() - 1].iter().all(|p| {
            matches!(
                p.to_ascii_lowercase().as_str(),
                "commandorcontrol" | "cmdorctrl" | "command" | "cmd" | "control" | "ctrl" | "alt"
                    | "option" | "shift" | "super" | "meta"
            )
        })
        && !parts[parts.len() - 1].is_empty()
}

/// OpenRouter model slugs: "vendor/model", optionally with ":variant".
pub fn valid_model(m: &str) -> bool {
    !m.is_empty()
        && m.len() <= 100
        && m.contains('/')
        && m.chars().all(|c| c.is_ascii_alphanumeric() || "-._/:".contains(c))
}

impl Settings {
    pub fn sanitized(mut self) -> Self {
        let d = Settings::default();
        self.hotkey = self.hotkey.trim().chars().take(64).collect();
        if !has_modifier(&self.hotkey) {
            self.hotkey = d.hotkey;
        }
        if self.overlay_round != 0 {
            self.overlay_round = self.overlay_round.min(1000);
        }
        self.overlay_new_cards = self.overlay_new_cards.min(1000);
        self.overlay_front = one_of(&self.overlay_front, &["term", "definition", "mixed"], "term");
        if !valid_time(&self.reminder_time) {
            self.reminder_time = d.reminder_time;
        }
        self.theme = one_of(&self.theme, &["system", "light", "dark"], "system");
        self.backups_kept = self.backups_kept.clamp(1, 90);
        self.ai_model = self.ai_model.trim().to_string();
        if !valid_model(&self.ai_model) {
            self.ai_model = d.ai_model;
        }
        self
    }
}

/// Whether the login item should be on at launch.
///
/// `on`: the OS will start the app. `registered`: the app's entry exists at
/// all — on Windows it can exist and still be off, when it was turned off in
/// Task Manager's Startup apps, and that choice is the user's to keep.
pub fn autostart_wanted(stored: Option<bool>, on: bool, registered: bool) -> bool {
    match stored {
        // Missing entry, stored "on": an installer took it. Put it back.
        Some(true) => on || !registered,
        // First launch with this field, stored "off", or turned off in Task
        // Manager: the OS has the last word.
        _ => on,
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(FILE))
        .map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn store(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let p = path(app)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Write-then-rename, so a crash mid-write never leaves half a file.
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn out_of_range_values_are_pulled_back() {
        let s = Settings {
            overlay_round: 5000,
            overlay_front: "upside-down".into(),
            reminder_time: "25:99".into(),
            theme: "neon".into(),
            ai_model: "rm -rf /".into(),
            hotkey: "   ".into(),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.overlay_round, 1000);
        // 0 is "every card in the set", and stays.
        assert_eq!(Settings { overlay_round: 0, ..Settings::default() }.sanitized().overlay_round, 0);
        assert_eq!(s.overlay_front, "term");
        assert_eq!(s.reminder_time, "18:00");
        assert_eq!(s.theme, "system");
        assert_eq!(s.ai_model, DEFAULT_MODEL);
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn an_old_file_with_missing_fields_still_loads() {
        // and one with fields since removed (dailyGoal) too
        let old: Settings = serde_json::from_str(r#"{"dailyGoal":20,"theme":"dark"}"#).unwrap();
        assert_eq!(old.theme, "dark");
        let s: Settings = serde_json::from_str(r#"{"hotkey":"Alt+K"}"#).unwrap();
        assert_eq!(s.hotkey, "Alt+K");
        assert_eq!(s.overlay_round, 10);
    }

    #[test]
    fn a_hotkey_needs_a_modifier() {
        assert!(has_modifier("CommandOrControl+Alt+F"));
        assert!(has_modifier("Shift+F9"));
        assert!(!has_modifier("A"));
        assert!(!has_modifier("Space"));
        assert!(!has_modifier("Foo+A"));
        let s = Settings { hotkey: "Space".into(), ..Settings::default() }.sanitized();
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn autostart_survives_a_reinstall_but_not_a_user_choice() {
        // The installer deleted the entry: back on.
        assert!(autostart_wanted(Some(true), false, false));
        // Turned off in Task Manager (entry still there): stays off.
        assert!(!autostart_wanted(Some(true), false, true));
        // Turned off in Settings: stays off.
        assert!(!autostart_wanted(Some(false), false, false));
        // A settings file from before the field: take what the OS has.
        assert!(autostart_wanted(None, true, true));
        assert!(!autostart_wanted(None, false, false));
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(old.autostart, None);
    }

    #[test]
    fn model_slugs() {
        assert!(valid_model("google/gemini-3.8-flash"));
        assert!(valid_model("meta-llama/llama-3.1-8b-instruct:free"));
        assert!(!valid_model("gpt"));
        assert!(!valid_model("a/b c"));
    }
}
