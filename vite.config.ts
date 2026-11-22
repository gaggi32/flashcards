/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const src = at('./src');

/** Where the web version is served: https://404canvas.ch/flashcards (CLAUDE.md, "Web version"). */
const WEB_BASE = '/flashcards/';

// The web build: each Tauri package is replaced by its browser stand-in in
// src/web/, which does what the Rust command or plugin did.
const webAliases = [
  { find: /^@tauri-apps\/api\/core$/, replacement: at('./src/web/tauri-core.ts') },
  { find: /^@tauri-apps\/api\/event$/, replacement: at('./src/web/tauri-event.ts') },
  { find: /^@tauri-apps\/api\/webviewWindow$/, replacement: at('./src/web/tauri-window.ts') },
  { find: /^@tauri-apps\/plugin-(notification|autostart)$/, replacement: at('./src/web/tauri-plugins.ts') },
];

/** The manifest, icons and phone meta tags, in the web build's index.html only. */
function webHead(): Plugin {
  return {
    name: 'flashcards-web-head',
    transformIndexHtml() {
      const b = WEB_BASE;
      const tags = [
        { tag: 'meta', attrs: { name: 'description', content: 'Flashcards in your browser. Your sets stay on this device.' } },
        { tag: 'meta', attrs: { name: 'robots', content: 'noindex' } },
        { tag: 'meta', attrs: { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f6f4ef' } },
        { tag: 'meta', attrs: { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#131210' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Flashcards' } },
        { tag: 'link', attrs: { rel: 'manifest', href: `${b}manifest.webmanifest` } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: `${b}icon-192.png` } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${b}apple-touch-icon.png` } },
      ];
      return tags.map((t) => ({ ...t, injectTo: 'head' as const }));
    },
  };
}

/**
 * Writes sw.js with the list of every file this build made, so the service
 * worker (web/sw.js) can keep them all for offline use. The list's hash is
 * the cache's name: a new build replaces the cache, an unchanged one keeps it.
 */
function webServiceWorker(): Plugin {
  return {
    name: 'flashcards-web-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
      // Every browser that runs this reads woff2; the .woff fallbacks are never fetched.
      const built = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.woff') && !f.endsWith('.map'));
      const files = [...built, ...publicFiles].sort();
      let h = 0;
      for (const ch of files.join('|')) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
      const source = readFileSync(at('./web/sw.js'), 'utf8')
        .replace("'__BASE__'", JSON.stringify(WEB_BASE))
        .replace("'__VERSION__'", JSON.stringify((h >>> 0).toString(36)))
        .replace("'__FILES__'", JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Two entry points, two windows, one bundle and one data layer: the full
// window (index.html) and the hotkey overlay (overlay.html). The web build
// (`--mode web`, see .env.web) has only the full window.
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    plugins: [react(), ...(web ? [webHead(), webServiceWorker()] : [])],
    base: web ? WEB_BASE : '/',
    publicDir: web ? 'web/public' : 'public',
    resolve: { alias: [...(web ? webAliases : []), { find: '@', replacement: src }] },
    clearScreen: false,
    server: {
      port: web ? 1431 : 1430,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    build: {
      target: 'es2021',
      outDir: web ? 'dist-web' : 'dist',
      rollupOptions: {
        input: (web
          ? { main: at('./index.html') }
          : { main: at('./index.html'), overlay: at('./overlay.html') }) as Record<string, string>,
      },
    },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  };
});
