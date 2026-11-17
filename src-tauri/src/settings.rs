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
    /// "small" | "normal" | "large", on top of the size that follows the screen.
    pub overlay_size: String,
    // --- answers ---
    /// "exact" | "easier": whether an answer listing alternatives ("a, b",
    /// "a / b") needs every one typed, or any one of them.
    pub answer_check: String,
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
    // --- study (chosen in the study screens, changed through [`StudyPref`]) ---
    /// The set the overlay studies; None until one is picked.
    pub overlay_set: Option<i64>,
    /// "cards" | "write" | "learn": the overlay's mode.
    pub overlay_mode: String,
    /// Whether the number keys type the special characters in Write and Learn.
    pub special_keys: bool,
    /// "term" | "definition": the side Flashcards shows first.
    pub cards_first_side: String,
    /// Set once the study choices older versions kept in the webview's
    /// localStorage have been taken over ([`Settings::adopt`]).
    pub local_prefs_adopted: bool,
    /// Set once the study sessions older versions kept in localStorage have
    /// gone into the database. Keeping it here, not in localStorage, matters:
    /// removing the old keys is itself a localStorage write a killed webview
    /// can lose, and a round finished since must not come back from them.
    pub sessions_carried_over: bool,
    /// The version whose "What's new" the user has seen (or that was first
    /// installed): the card shows what came after it. Empty on a first start.
    pub last_seen_version: String,
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
            overlay_size: "normal".into(),
            answer_check: "exact".into(),
            reminders: false,
            reminder_time: "18:00".into(),
            theme: "system".into(),
            eye_comfort: false,
            auto_backup: true,
            backups_kept: 7,
            ai_model: DEFAULT_MODEL.into(),
            check_updates: true,
            autostart: None,
            overlay_set: None,
            overlay_mode: "cards".into(),
            special_keys: true,
            cards_first_side: "term".into(),
            local_prefs_adopted: false,
            sessions_carried_over: false,
            last_seen_version: String::new(),
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

/// "1.2.3", nothing else.
pub fn is_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    v.len() <= 20 && parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
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
        self.overlay_size = one_of(&self.overlay_size, &["small", "normal", "large"], "normal");
        self.answer_check = one_of(&self.answer_check, &["exact", "easier"], "exact");
        if !valid_time(&self.reminder_time) {
            self.reminder_time = d.reminder_time;
        }
        self.theme = one_of(&self.theme, &["system", "light", "dark"], "system");
        self.backups_kept = self.backups_kept.clamp(1, 90);
        self.ai_model = self.ai_model.trim().to_string();
        if !valid_model(&self.ai_model) {
            self.ai_model = d.ai_model;
        }
        self.overlay_set = self.overlay_set.filter(|&id| id > 0);
        self.overlay_mode = one_of(&self.overlay_mode, &["cards", "write", "learn"], "cards");
        self.cards_first_side = one_of(&self.cards_first_side, &["term", "definition"], "term");
        if !is_version(&self.last_seen_version) {
            self.last_seen_version = String::new();
        }
        self
    }

    /// The fields only their own commands change, taken from `prev`, so a
    /// stale copy of the settings in the Settings screen can't undo them.
    pub fn keep_own_fields(&mut self, prev: &Settings) {
        self.autostart = prev.autostart;
        self.overlay_set = prev.overlay_set;
        self.overlay_mode = prev.overlay_mode.clone();
        self.special_keys = prev.special_keys;
        self.cards_first_side = prev.cards_first_side.clone();
        self.local_prefs_adopted = prev.local_prefs_adopted;
        self.sessions_carried_over = prev.sessions_carried_over;
        self.last_seen_version = prev.last_seen_version.clone();
    }

    pub fn with(mut self, pref: StudyPref) -> Self {
        match pref {
            StudyPref::OverlaySet(id) => self.overlay_set = id,
            StudyPref::OverlayMode(mode) => self.overlay_mode = mode,
            StudyPref::SpecialKeys(on) => self.special_keys = on,
            StudyPref::CardsFirstSide(side) => self.cards_first_side = side,
        }
        self.sanitized()
    }

    /// Takes over the study choices an older version left in localStorage,
    /// once. A choice this file already has wins: a field is only filled
    /// while it still holds its default.
    pub fn adopt(mut self, old: LocalPrefs) -> Self {
        if self.local_prefs_adopted {
            return self;
        }
        let d = Settings::default();
        if self.overlay_set.is_none() {
            self.overlay_set = old.overlay_set;
        }
        if let Some(mode) = old.overlay_mode.filter(|_| self.overlay_mode == d.overlay_mode) {
            self.overlay_mode = mode;
        }
        if let Some(on) = old.special_keys.filter(|_| self.special_keys == d.special_keys) {
            self.special_keys = on;
        }
        if let Some(side) = old.cards_first_side.filter(|_| self.cards_first_side == d.cards_first_side) {
            self.cards_first_side = side;
        }
        self.local_prefs_adopted = true;
        self.sanitized()
    }
}

/// One study choice, as the study screens send it: `{"key": .., "value": ..}`.
/// Both windows make these, so the command that takes them is open to the
/// overlay, and it can change nothing else.
#[derive(Debug, Deserialize)]
#[serde(tag = "key", content = "value", rename_all = "camelCase")]
pub enum StudyPref {
    OverlaySet(Option<i64>),
    OverlayMode(String),
    SpecialKeys(bool),
    CardsFirstSide(String),
}

/// What versions up to 0.1.14 kept in the webview's localStorage, which loses
/// its newest writes when the webview is killed rather than closed (a restart
/// with the app in the tray). The main window reads it there and hands it
/// over once; anything may be missing.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LocalPrefs {
    pub overlay_set: Option<i64>,
    pub overlay_mode: Option<String>,
    pub special_keys: Option<bool>,
    pub cards_first_side: Option<String>,
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
            overlay_size: "huge".into(),
            answer_check: "lenient".into(),
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
        assert_eq!(s.overlay_size, "normal");
        assert_eq!(s.answer_check, "exact");
        assert_eq!(s.ai_model, DEFAULT_MODEL);
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn an_old_file_with_missing_fields_still_loads() {
        // and one with fields since removed (dailyGoal) too
        let old: Settings = serde_json::from_str(r#"{"dailyGoal":20,"theme":"dark"}"#).unwrap();
        assert_eq!(old.theme, "dark");
        assert_eq!(old.overlay_size, "normal");
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
    fn study_choices_load_check_and_change_one_at_a_time() {
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(old.overlay_set, None);
        assert_eq!(old.overlay_mode, "cards");
        assert!(old.special_keys);
        assert_eq!(old.cards_first_side, "term");
        assert!(!old.local_prefs_adopted);
        assert!(!old.sessions_carried_over);

        let pref = |json: &str| serde_json::from_str::<StudyPref>(json).unwrap();
        let s = Settings::default()
            .with(pref(r#"{"key":"overlaySet","value":7}"#))
            .with(pref(r#"{"key":"overlayMode","value":"learn"}"#))
            .with(pref(r#"{"key":"specialKeys","value":false}"#))
            .with(pref(r#"{"key":"cardsFirstSide","value":"definition"}"#));
        assert_eq!(s.overlay_set, Some(7));
        assert_eq!(s.overlay_mode, "learn");
        assert!(!s.special_keys);
        assert_eq!(s.cards_first_side, "definition");
        assert_eq!(s.theme, "system");
        assert_eq!(s.with(pref(r#"{"key":"overlaySet","value":null}"#)).overlay_set, None);

        let s = Settings::default()
            .with(pref(r#"{"key":"overlaySet","value":-3}"#))
            .with(pref(r#"{"key":"overlayMode","value":"sideways"}"#))
            .with(pref(r#"{"key":"cardsFirstSide","value":"back"}"#));
        assert_eq!(s.overlay_set, None);
        assert_eq!(s.overlay_mode, "cards");
        assert_eq!(s.cards_first_side, "term");
        // Nothing else can be changed this way.
        assert!(serde_json::from_str::<StudyPref>(r#"{"key":"theme","value":"dark"}"#).is_err());
        assert!(serde_json::from_str::<StudyPref>(r#"{"key":"specialKeys","value":"on"}"#).is_err());
    }

    #[test]
    fn the_version_seen_is_a_version_or_nothing() {
        assert_eq!(Settings::default().last_seen_version, "");
        for bad in ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "../../x", " 1.2.3"] {
            let s = Settings { last_seen_version: bad.into(), ..Settings::default() }.sanitized();
            assert_eq!(s.last_seen_version, "", "{bad}");
        }
        let s = Settings { last_seen_version: "0.1.20".into(), ..Settings::default() }.sanitized();
        assert_eq!(s.last_seen_version, "0.1.20");
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"lastSeenVersion\":\"0.1.20\""), "{json}");
    }

    #[test]
    fn a_settings_save_leaves_the_study_choices_alone() {
        let prev = Settings {
            overlay_set: Some(4),
            overlay_mode: "write".into(),
            special_keys: false,
            cards_first_side: "definition".into(),
            local_prefs_adopted: true,
            sessions_carried_over: true,
            last_seen_version: "0.1.19".into(),
            autostart: Some(true),
            ..Settings::default()
        };
        let mut next = Settings { theme: "dark".into(), ..Settings::default() };
        next.keep_own_fields(&prev);
        // ...nor show an old "What's new" again.
        assert_eq!(next.last_seen_version, "0.1.19");
        // A stale copy can't make the sessions be carried over again.
        assert!(next.sessions_carried_over);
        assert!(next.local_prefs_adopted);
        assert_eq!(next, Settings { theme: "dark".into(), ..prev });
    }

    #[test]
    fn local_storage_is_taken_over_once_and_never_over_the_file() {
        let local = || LocalPrefs {
            overlay_set: Some(3),
            overlay_mode: Some("write".into()),
            special_keys: Some(false),
            cards_first_side: Some("definition".into()),
        };
        // A file without the fields: everything comes over.
        let s = Settings::default().adopt(local());
        assert_eq!(s.overlay_set, Some(3));
        assert_eq!(s.overlay_mode, "write");
        assert!(!s.special_keys);
        assert_eq!(s.cards_first_side, "definition");
        assert!(s.local_prefs_adopted);

        // The file already has choices of its own: they stay.
        let file = Settings {
            overlay_set: Some(9),
            overlay_mode: "learn".into(),
            ..Settings::default()
        };
        let s = file.adopt(local());
        assert_eq!(s.overlay_set, Some(9));
        assert_eq!(s.overlay_mode, "learn");
        assert!(!s.special_keys);

        // Only once: a leftover key on a later start changes nothing, even
        // where the file holds a default the user picked since.
        let done = Settings::default().adopt(LocalPrefs::default());
        assert!(done.local_prefs_adopted);
        assert_eq!(done.clone().adopt(local()), done);

        // Whatever localStorage held is checked like anything else.
        let junk = LocalPrefs {
            overlay_set: Some(0),
            overlay_mode: Some("<script>".into()),
            ..LocalPrefs::default()
        };
        let s = Settings::default().adopt(junk);
        assert_eq!(s.overlay_set, None);
        assert_eq!(s.overlay_mode, "cards");
        let partial: LocalPrefs = serde_json::from_str(r#"{"specialKeys":false}"#).unwrap();
        assert!(!Settings::default().adopt(partial).special_keys);
    }

    #[test]
    fn model_slugs() {
        assert!(valid_model("google/gemini-3.8-flash"));
        assert!(valid_model("meta-llama/llama-3.1-8b-instruct:free"));
        assert!(!valid_model("gpt"));
        assert!(!valid_model("a/b c"));
    }
}
