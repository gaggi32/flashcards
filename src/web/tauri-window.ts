// Stands in for @tauri-apps/api/webviewWindow in the web build: each tab is
// its own "window", so events it sent itself can be told apart.

import { TAB } from './bus';

export function getCurrentWebviewWindow(): { label: string } {
  return { label: TAB };
}
