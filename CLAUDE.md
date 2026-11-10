# Flashcards (desktop)

Tauri v2 desktop app for Windows and macOS: the 404canvas.ch flashcards ported
to a local SQLite store, plus a hotkey study overlay. Sibling apps with the
same shape: `C:\dev\dash`, `C:\dev\lingo`.

## Commands
- `npm install` — once.
- `npm run tauri:dev` — run the app (Vite on :1430 + Rust debug build).
- `npm test` — Vitest: ported study logic + the store against node:sqlite.
- `npm run typecheck` — tsc.
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust unit tests (needs `dist/` to exist; `mkdir dist` if missing).
- `npm run tauri:build` — local installer in `src-tauri/target/release/bundle/`.
- Icon: `node scripts/make-icon.mjs && npx tauri icon app-icon.png`, then delete everything in `src-tauri/icons/` except the five files `tauri.conf.json` lists.

## Layout
- `src-tauri/src/lib.rs` — windows (built in Rust with a navigation guard), tray, hotkey, every command.
- `src-tauri/src/db.rs` — the one SQLite connection; `db_select` / `db_batch` (a batch = one transaction, `{"$lastId": k}` params). Schema in `src-tauri/schema/*.sql`.
- `src-tauri/src/ai.rs` — OpenRouter key in the OS credential store; fixed endpoints only.
- `src/lib/store/` — what the web API routes did (`repo.ts`), export/import (`transfer.ts`).
- `src/lib/flashcards/client.ts` — same function names as the website's client, now backed by the store.
- `src/screens/`, `src/components/flashcards/` — ported from `404canvas/src/app/flashcards`.
- `src/overlay/` — the hotkey window.

## Conventions
- Card text only ever goes into SQL as a bound `?` parameter. `db.rs` refuses ATTACH/VACUUM/PRAGMA from the UI.
- The UI never names a file path or URL for Rust to use: files go through native dialogs in Rust, links through the `open_link` allow-list.
- Schema changes: add `src-tauri/schema/00N_*.sql`, list it in `db.rs` MIGRATIONS and in `src/lib/store/testDb.ts`. Never edit a shipped step.
- No `window.confirm/prompt` (WKWebView): use `ask` from `src/components/Dialogs.tsx`.
- Version lives in three places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. The release job refuses a tag that does not match all three.

## Releasing
Bump the three versions, commit, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` builds Windows x64 + macOS arm64/x64, uploads installers and `.sha256` files, publishes, and dispatches `flashcards-release` to gaggi32/404canvas, which updates the download page.

## Only Michele can do
- Create the GitHub repo and push; add secret `CANVAS_DEPLOY_TOKEN` (PAT that can dispatch to 404canvas).
- Make sure the Vercel `GITHUB_RELEASE_TOKEN` can read this repo's releases (fine-grained PAT: add the repo).
- Code signing certificates (Apple Developer ID, Windows signing) if wanted.
