// Stands in for @tauri-apps/plugin-notification and plugin-autostart in the
// web build. The web version has no daily reminder (a closed tab cannot
// remind anyone) and no login item.

export async function isPermissionGranted(): Promise<boolean> {
  return false;
}
export async function requestPermission(): Promise<'granted' | 'denied' | 'default'> {
  return 'denied';
}
export function sendNotification(_options: { title: string; body?: string }): void {}

export async function isEnabled(): Promise<boolean> {
  return false;
}
