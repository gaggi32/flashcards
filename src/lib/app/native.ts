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

export type Settings = {
  hotkey: string;
  overlayRound: number;
  overlayNewCards: number;
  overlayFront: OverlayFront;
  overlayHideOnBlur: boolean;
  overlayTopmostWatch: boolean;
  reminders: boolean;
  reminderTime: string;
  theme: ThemeChoice;
  eyeComfort: boolean;
  autoBackup: boolean;
  backupsKept: number;
  aiModel: string;
  checkUpdates: boolean;
};

export const getSettings = () => call<Settings>('get_settings');
export const saveSettings = (settings: Settings) => call<Settings>('save_settings', { settings });
export const suspendHotkey = () => call<void>('suspend_hotkey');
export const resumeHotkey = () => call<void>('resume_hotkey');

export type AppInfo = { version: string; dataDir: string; platform: 'windows' | 'macos' | 'linux' };
export const appInfo = () => call<AppInfo>('app_info');

export type UpdateInfo = { current: string; latest: string | null; newer: boolean };
export const checkUpdate = () => call<UpdateInfo>('check_update');
export const openDownloadPage = () => call<void>('open_download_page');
export const openLink = (url: string) => call<void>('open_link', { url });
export const openDataFolder = () => call<void>('open_data_folder');

export const backupNow = (stamp: string) => call<string>('backup_now', { stamp });
export const exportFile = (contents: string, suggestedName: string) =>
  call<string | null>('export_file', { contents, suggestedName });
export const importFile = (kind: 'json' | 'text') => call<string | null>('import_file', { kind });

export const hideOverlay = () => call<void>('hide_overlay');
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
