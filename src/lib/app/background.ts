// Jobs the main window runs while the app sits in the tray: the tray tooltip,
// the daily reminder, the daily backup and the update check. The main window
// is created at start-up and only ever hidden, so its timers keep running.

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

import { todayKey } from '@/lib/nutrition/day';
import { todayNumbers } from '@/lib/store/repo';
import { onDataChanged } from './events';
import { backupNow, checkUpdate, getSettings, setTrayStatus, stampNow, type UpdateInfo } from './native';

const REMINDED = 'flashcards:reminded-on';
const BACKED_UP = 'flashcards:backed-up-on';
const UPDATE_EVERY_MS = 12 * 60 * 60 * 1000;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* worst case: one extra reminder or backup */
  }
}

let update: UpdateInfo | null = null;
const updateListeners = new Set<(u: UpdateInfo) => void>();

export function latestUpdate(): UpdateInfo | null {
  return update;
}
export function onUpdate(cb: (u: UpdateInfo) => void): () => void {
  updateListeners.add(cb);
  return () => updateListeners.delete(cb);
}

async function refreshTray() {
  try {
    const n = await todayNumbers(todayKey());
    const parts = [n.due ? `${n.due} due` : 'nothing due', `${n.reviewed} studied today`];
    if (n.streak > 1) parts.push(`${n.streak}-day streak`);
    await setTrayStatus(`Flashcards — ${parts.join(' · ')}`);
  } catch {
    /* the tooltip is decoration */
  }
}

async function maybeRemind() {
  const s = await getSettings();
  const today = todayKey();
  if (!s.reminders || stored(REMINDED) === today) return;
  const now = new Date();
  const [h, m] = s.reminderTime.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  const n = await todayNumbers(today);
  store(REMINDED, today);
  if (n.reviewed >= s.dailyGoal || n.due + n.fresh === 0) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === 'granted';
  if (!granted) return;
  const left = s.dailyGoal - n.reviewed;
  sendNotification({
    title: 'Flashcards',
    body:
      n.due > 0
        ? `${n.due} card${n.due === 1 ? '' : 's'} due. ${left} more answers reach today's goal.`
        : `${left} more answers reach today's goal.`,
  });
}

async function maybeBackup() {
  const s = await getSettings();
  const today = todayKey();
  if (!s.autoBackup || stored(BACKED_UP) === today) return;
  await backupNow(stampNow());
  store(BACKED_UP, today);
}

async function maybeCheckUpdate() {
  const s = await getSettings();
  if (!s.checkUpdates) return;
  try {
    update = await checkUpdate();
    for (const cb of updateListeners) cb(update);
  } catch {
    /* offline: try again next round */
  }
}

export function startBackgroundJobs(): void {
  const safe = (f: () => Promise<void>) => () => void f().catch(() => {});
  safe(refreshTray)();
  safe(maybeBackup)();
  setTimeout(safe(maybeCheckUpdate), 5_000);
  setInterval(() => {
    safe(refreshTray)();
    safe(maybeRemind)();
    safe(maybeBackup)();
  }, 60_000);
  setInterval(safe(maybeCheckUpdate), UPDATE_EVERY_MS);
  onDataChanged(safe(refreshTray));
}

/** Called after this window's own writes, which onDataChanged skips. */
export const refreshTrayNow = () => void refreshTray();
