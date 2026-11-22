// Which build this is. The desktop app (Tauri) is the default; `npm run
// build:web` sets VITE_TARGET=web (.env.web) for the browser version, whose
// "Rust side" is src/web/. Vite replaces the constant at build time, so the
// branches the other build never takes are left out of its bundle.

export const IS_WEB = import.meta.env.VITE_TARGET === 'web';
