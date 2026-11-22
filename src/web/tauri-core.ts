// Stands in for @tauri-apps/api/core in the web build (vite.config.ts aliases
// it): `invoke` runs each Rust command of src-tauri/src/lib.rs here, in the
// browser, so the screens and the store work unchanged. Errors are plain
// strings, as Rust's are. Commands with no meaning in a browser (the overlay,
// the tray, the hotkey, the login item) do nothing.

import type { AppInfo, Settings, StudyPrefs, UpdateInfo } from '@/lib/app/native';
import type { Param, Stmt } from '@/lib/store/db';

import { version as APP_VERSION } from '../../package.json';
import * as ai from './ai';
import { database } from './database';
import { pickFile, saveFile } from './files';
import { DESKTOP_PAGE } from './links';
import * as settings from './settings';

type Args = Record<string, unknown>;

function platform(): AppInfo['platform'] {
  const p = `${navigator.platform} ${navigator.userAgent}`;
  if (/Mac|iPhone|iPad/i.test(p)) return 'macos';
  if (/Win/i.test(p)) return 'windows';
  return 'linux';
}

function openTab(url: string): void {
  if (!/^https?:\/\//i.test(url)) throw 'Only web links open from here.';
  window.open(url, '_blank', 'noopener,noreferrer');
}

const nothing = async () => undefined;
const notHere = (what: string) => async () => {
  throw `${what} is part of the desktop app, not the web version.`;
};

const COMMANDS: Record<string, (args: Args) => Promise<unknown>> = {
  db_select: async (a) => (await database()).select(a.sql as string, (a.params as Param[]) ?? []),
  db_batch: async (a) => (await database()).batch(a.statements as Stmt[]),

  get_settings: () => settings.getSettings(),
  save_settings: (a) => settings.saveSettings(a.settings as Settings),
  set_study_pref: (a) => settings.setStudyPref(a.pref as { key: keyof StudyPrefs; value: unknown }),
  adopt_local_prefs: () => settings.getSettings(),
  mark_sessions_carried_over: () => settings.getSettings(),
  mark_version_seen: (a) => settings.markVersionSeen(String(a.version)),
  set_autostart: async () => false,

  app_info: async (): Promise<AppInfo> => ({ version: APP_VERSION, dataDir: 'this browser', platform: platform() }),
  // The web version is always the newest: the page loads it fresh.
  check_update: async (): Promise<UpdateInfo> => ({
    current: APP_VERSION,
    latest: APP_VERSION,
    newer: false,
    notes: null,
    missed: [],
  }),
  install_update: notHere('Installing updates'),
  open_download_page: async () => openTab(DESKTOP_PAGE),
  open_link: async (a) => openTab(String(a.url)),
  open_data_folder: notHere('The data folder'),
  backup_now: notHere('The backups folder'),

  export_file: (a) => saveFile(String(a.contents), String(a.suggestedName)),
  // No await before the picker opens: browsers only open it straight from a click.
  import_file: (a) => pickFile(a.kind === 'json' ? 'json' : 'text'),
  drag_set_out: async () => false,
  // The page's print styles lay the test out; the browser's print dialog has "Save as PDF".
  save_pdf: async () => {
    window.print();
    return null;
  },

  ai_key_status: () => ai.keyStatus(),
  ai_set_key: (a) => ai.setKey(String(a.key)),
  ai_clear_key: () => ai.clearKey(),
  ai_request: (a) => ai.request(String(a.endpoint), a.body),

  suspend_hotkey: nothing,
  resume_hotkey: nothing,
  set_tray_status: nothing,
  show_overlay: nothing,
  hide_overlay: nothing,
  overlay_closed: nothing,
  overlay_fit: nothing,
  overlay_state: async () => [false, 0],
  open_main: nothing,
};

export function invoke<T>(cmd: string, args: Args = {}): Promise<T> {
  const run = COMMANDS[cmd];
  if (!run) return Promise.reject(`Unknown command ${cmd}`);
  try {
    // Called synchronously, so a command that opens a picker still runs
    // inside the click that asked for it.
    return run(args) as Promise<T>;
  } catch (err) {
    return Promise.reject(err);
  }
}
