// Typed wrappers around the Rust commands in src-tauri/src/lib.rs. Every
// rejection comes back as an ApiError, like the data calls.

import { invoke } from '@tauri-apps/api/core';

import { asApiError } from '@/lib/store/errors';

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw asApiError(err);
  }
}

export type OverlayFront = 'term' | 'definition' | 'mixed';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type OverlaySize = 'small' | 'normal' | 'large';
/** See AnswerCheck in flashcards/write.ts. */
export type AnswerCheckChoice = 'exact' | 'easier';
export type OverlayMode = 'cards' | 'write' | 'learn' | 'test';

export type Settings = {
  hotkey: string;
  overlayRound: number;
  overlayNewCards: number;
  overlayFront: OverlayFront;
  overlayHideOnBlur: boolean;
  overlayTopmostWatch: boolean;
  overlaySize: OverlaySize;
  answerCheck: AnswerCheckChoice;
  reminders: boolean;
  reminderTime: string;
  theme: ThemeChoice;
  eyeComfort: boolean;
  autoBackup: boolean;
  backupsKept: number;
  aiModel: string;
  checkUpdates: boolean;
  /** Start with the computer; null until the app has read it from the OS. */
  autostart: boolean | null;
  // Chosen in the study screens and changed through setStudyPref; a save of
  // the rest leaves them as they are.
  /** The set the overlay studies; null until one is picked. */
  overlaySet: number | null;
  overlayMode: OverlayMode;
  /** Whether the number keys type the special characters in Write and Learn. */
  specialKeys: boolean;
  /** The side Flashcards shows first. */
  cardsFirstSide: 'term' | 'definition';
  /** The choices older versions kept in localStorage have been taken over. */
  localPrefsAdopted: boolean;
  /** The study sessions older versions kept in localStorage are in the database. */
  sessionsCarriedOver: boolean;
  /** The version whose What's new was last seen; "" on a first start. */
  lastSeenVersion: string;
};

export type StudyPrefs = Pick<Settings, 'overlaySet' | 'overlayMode' | 'specialKeys' | 'cardsFirstSide'>;

export const getSettings = () => call<Settings>('get_settings');
export const saveSettings = (settings: Settings) => call<Settings>('save_settings', { settings });
/** One study choice; either window may make it. */
export const setStudyPref = <K extends keyof StudyPrefs>(key: K, value: StudyPrefs[K]) =>
  call<Settings>('set_study_pref', { pref: { key, value } });
/** Hands Rust what an older version left in localStorage (main window only, once). */
export const adoptLocalPrefs = (prefs: Partial<StudyPrefs>) => call<Settings>('adopt_local_prefs', { prefs });
/** The old localStorage sessions are in the database: never import them again (either window). */
export const markSessionsCarriedOver = () => call<Settings>('mark_sessions_carried_over');
/** Turns the login item on or off and remembers it; resolves to whether the OS now has it on. */
export const setAutostart = (on: boolean) => call<boolean>('set_autostart', { on });
export const suspendHotkey = () => call<void>('suspend_hotkey');
export const resumeHotkey = () => call<void>('resume_hotkey');

export type AppInfo = { version: string; dataDir: string; platform: 'windows' | 'macos' | 'linux' };
export const appInfo = () => call<AppInfo>('app_info');

/**
 * `notes`: the newest release's notes, its CHANGELOG section. `missed`: every
 * version the update brings, newest first, each with its notes (empty when
 * there is nothing newer).
 */
export type UpdateInfo = {
  current: string;
  latest: string | null;
  newer: boolean;
  notes: string | null;
  missed: { version: string; notes: string }[];
};
export const checkUpdate = () => call<UpdateInfo>('check_update');
/** Downloads, checks the signature, installs and restarts; progress comes as "update-progress". */
export const installUpdate = () => call<void>('install_update');
export const markVersionSeen = (version: string) => call<Settings>('mark_version_seen', { version });
export const openDownloadPage = () => call<void>('open_download_page');
export const openLink = (url: string) => call<void>('open_link', { url });
export const openDataFolder = () => call<void>('open_data_folder');

export const backupNow = (stamp: string) => call<string>('backup_now', { stamp });
export const exportFile = (contents: string, suggestedName: string) =>
  call<string | null>('export_file', { contents, suggestedName });
export const importFile = (kind: 'json' | 'text') => call<string | null>('import_file', { kind });
/** Drag a set's file out of the window (the OS drag); true when it was dropped somewhere. */
export const dragSetOut = (contents: string, suggestedName: string) =>
  call<boolean>('drag_set_out', { contents, suggestedName });

export const hideOverlay = () => call<void>('hide_overlay');
/** The overlay page finished playing close number `gen`: the window may go. */
export const overlayClosed = (gen: number) => call<void>('overlay_closed', { gen });
/** [is the overlay up, the latest open/close number] */
/** The overlay page's content is `height` CSS px tall: Rust sizes the window to it. */
export const overlayFit = (height: number) => call<void>('overlay_fit', { height });
export const overlayState = () => call<[boolean, number]>('overlay_state');
export const showOverlay = () => call<void>('show_overlay');
export const openMain = (route?: string) => call<void>('open_main', { route: route ?? null });
export const setTrayStatus = (text: string) => call<void>('set_tray_status', { text });

export type KeyStatus = { present: boolean; hint: string | null };
export const aiKeyStatus = () => call<KeyStatus>('ai_key_status');
export const aiSetKey = (key: string) => call<KeyStatus>('ai_set_key', { key });
export const aiClearKey = () => call<KeyStatus>('ai_clear_key');
export type AiReply = { status: number; body: string };
export const aiRequest = (endpoint: 'chat' | 'key' | 'credits', body?: unknown) =>
  call<AiReply>('ai_request', { endpoint, body: body ?? null });

/** YYYYMMDD-HHMMSS in local time, for backup file names. */
export function stampNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * The page as it prints, as a PDF. Windows: a save dialog, then the path (null
 * when cancelled). macOS: the print panel opens (it has "Save as PDF"); null.
 */
export const savePdf = (suggestedName: string) => call<string | null>('save_pdf', { suggestedName });
