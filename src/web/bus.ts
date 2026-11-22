// Events in the web version: what Tauri's emit/listen do between the two
// desktop windows, here inside one tab, plus a BroadcastChannel so other tabs
// of the web app hear that the data or the settings changed.

export type BusEvent<T = unknown> = { event: string; id: number; payload: T };
type Handler = (e: BusEvent) => void;

const handlers = new Map<string, Set<Handler>>();
let nextId = 1;

/** This tab's name, standing in for the desktop window's label. */
export const TAB = `tab-${Math.random().toString(36).slice(2, 10)}`;

export function emitLocal(event: string, payload: unknown): void {
  const e: BusEvent = { event, id: nextId++, payload };
  for (const h of [...(handlers.get(event) ?? [])]) {
    try {
      h(e);
    } catch (err) {
      console.error(err);
    }
  }
}

export function on(event: string, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  return () => void set.delete(handler);
}

/** What one tab tells the others. */
export type TabMessage =
  | { type: 'db'; version: number; from: string }
  | { type: 'settings'; from: string };

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('flashcards-web');

export function tellOtherTabs(msg: TabMessage): void {
  try {
    channel?.postMessage(msg);
  } catch {
    /* the other tabs catch up when they next write or get focus */
  }
}

export function onOtherTab(cb: (msg: TabMessage) => void): void {
  channel?.addEventListener('message', (e: MessageEvent<TabMessage>) => {
    if (e.data && e.data.from !== TAB) cb(e.data);
  });
}
