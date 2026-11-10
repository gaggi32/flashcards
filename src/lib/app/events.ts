// Cross-window notices. Both windows read the same database, so after a write
// one window tells the other to read again.

import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect, useState } from 'react';

import type { Settings } from './native';

const DATA_CHANGED = 'data-changed';

function label(): string {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return 'unknown';
  }
}

export function announceDataChange(): void {
  void emit(DATA_CHANGED, { from: label() }).catch(() => {});
}

/** Runs `cb` when another window changed the data. */
export function onDataChanged(cb: () => void): () => void {
  const me = label();
  const off = listen<{ from: string }>(DATA_CHANGED, (e) => {
    if (e.payload?.from !== me) cb();
  });
  return () => void off.then((f) => f()).catch(() => {});
}

/** A number that goes up whenever another window changes the data. */
export function useDataVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);
  return version;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const off = listen<Settings>('settings-changed', (e) => cb(e.payload));
  return () => void off.then((f) => f()).catch(() => {});
}
