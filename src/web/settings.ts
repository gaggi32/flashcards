// settings.rs for the web version: the same Settings shape, kept in
// IndexedDB, with the same rules (every field has a default, a save from the
// Settings screen cannot change the study choices, a study choice changes
// one field). Desktop-only switches keep their defaults and are not shown.

import type { Settings, StudyPrefs } from '@/lib/app/native';

import { TAB, emitLocal, onOtherTab, tellOtherTabs } from './bus';
import { idbGet, idbPut } from './idb';

const KEY = 'settings';
export const DEFAULT_MODEL = 'google/gemini-3.8-flash';

export const DEFAULTS: Settings = {
  hotkey: 'CommandOrControl+Alt+F',
  overlayRound: 10,
  overlayNewCards: 5,
  overlayFront: 'term',
  overlayHideOnBlur: true,
  overlayTopmostWatch: false,
  overlaySize: 'normal',
  answerCheck: 'exact',
  reminders: false,
  reminderTime: '18:00',
  theme: 'system',
  eyeComfort: false,
  motion: 'full',
  // No backups folder, no updater and no login item in a browser.
  autoBackup: false,
  backupsKept: 7,
  aiModel: DEFAULT_MODEL,
  checkUpdates: false,
  autostart: false,
  overlaySet: null,
  overlayMode: 'cards',
  specialKeys: true,
  cardsFirstSide: 'term',
  // Nothing from an older version to carry over: the web version starts here.
  localPrefsAdopted: true,
  sessionsCarriedOver: true,
  lastSeenVersion: '',
  lastRunVersion: '',
};

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const int = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

export const validModel = (m: string) => m.length > 0 && m.length <= 100 && m.includes('/') && /^[A-Za-z0-9\-._/:]+$/.test(m);

/** Settings::sanitized: anything off-pattern goes back to its default. */
export function sanitize(raw: Partial<Settings> | null | undefined): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULTS;
  const model = typeof r.aiModel === 'string' ? r.aiModel.trim() : '';
  const set = r.overlaySet;
  return {
    ...d,
    overlayRound: int(r.overlayRound, d.overlayRound, 0, 1000),
    overlayNewCards: int(r.overlayNewCards, d.overlayNewCards, 0, 1000),
    overlayFront: oneOf(r.overlayFront, ['term', 'definition', 'mixed'], d.overlayFront),
    answerCheck: oneOf(r.answerCheck, ['exact', 'easier'], d.answerCheck),
    theme: oneOf(r.theme, ['system', 'light', 'dark'], d.theme),
    eyeComfort: bool(r.eyeComfort, d.eyeComfort),
    motion: oneOf(r.motion, ['full', 'calm', 'off'], d.motion),
    aiModel: validModel(model) ? model : d.aiModel,
    overlaySet: typeof set === 'number' && Number.isSafeInteger(set) && set > 0 ? set : null,
    overlayMode: oneOf(r.overlayMode, ['cards', 'write', 'learn', 'test'], d.overlayMode),
    specialKeys: bool(r.specialKeys, d.specialKeys),
    cardsFirstSide: oneOf(r.cardsFirstSide, ['term', 'definition'], d.cardsFirstSide),
    lastSeenVersion: typeof r.lastSeenVersion === 'string' ? r.lastSeenVersion.slice(0, 20) : '',
  };
}

let cache: Promise<Settings> | null = null;

export function getSettings(): Promise<Settings> {
  cache ??= idbGet<Partial<Settings>>(KEY)
    .then(sanitize)
    .catch((err: unknown) => {
      cache = null;
      throw err;
    });
  return cache;
}

async function store(next: Settings): Promise<Settings> {
  await idbPut({ [KEY]: next });
  cache = Promise.resolve(next);
  emitLocal('settings-changed', next);
  tellOtherTabs({ type: 'settings', from: TAB });
  return next;
}

/** save_settings: the study choices and bookkeeping stay as stored. */
export async function saveSettings(incoming: Settings): Promise<Settings> {
  const prev = await getSettings();
  const next = sanitize({
    ...incoming,
    overlaySet: prev.overlaySet,
    overlayMode: prev.overlayMode,
    specialKeys: prev.specialKeys,
    cardsFirstSide: prev.cardsFirstSide,
    lastSeenVersion: prev.lastSeenVersion,
  });
  return store(next);
}

/** set_study_pref: one study choice, nothing else. */
export async function setStudyPref(pref: { key: keyof StudyPrefs; value: unknown }): Promise<Settings> {
  const allowed: (keyof StudyPrefs)[] = ['overlaySet', 'overlayMode', 'specialKeys', 'cardsFirstSide'];
  if (!allowed.includes(pref.key)) throw 'Unknown study choice';
  const prev = await getSettings();
  return store(sanitize({ ...prev, [pref.key]: pref.value }));
}

export async function markVersionSeen(version: string): Promise<Settings> {
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version)) throw 'Not a version';
  const prev = await getSettings();
  return prev.lastSeenVersion === version ? prev : store({ ...prev, lastSeenVersion: version });
}

// Another tab saved settings: read them again and tell this tab.
onOtherTab((msg) => {
  if (msg.type !== 'settings') return;
  cache = null;
  getSettings()
    .then((s) => emitLocal('settings-changed', s))
    .catch(() => {});
});
