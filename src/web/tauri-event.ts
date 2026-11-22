// Stands in for @tauri-apps/api/event in the web build: the same emit and
// listen, on this tab's event bus (bus.ts). Other tabs hear about data and
// settings changes through the database and settings modules, not from here.

import { emitLocal, on, type BusEvent } from './bus';

export type Event<T> = BusEvent<T>;
export type UnlistenFn = () => void;

export async function listen<T>(event: string, handler: (e: Event<T>) => void): Promise<UnlistenFn> {
  return on(event, handler as (e: BusEvent) => void);
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  emitLocal(event, payload);
}
