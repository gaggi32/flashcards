# Flashcards (desktop)

Tauri v2 desktop app for Windows and macOS, standalone: flashcards on a local
SQLite store, plus a hotkey study overlay. No website: it talks only to GitHub
(update check) and OpenRouter (AI, with the user's key). Sibling apps with the
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
- `src/lib/flashcards/client.ts` — what the screens call, backed by the store.
- `src/screens/`, `src/components/flashcards/` — the study screens.
- `src/overlay/` — the hotkey window.
- `src/styles/` — `tokens.css` (every colour/font for light, dark and both eye-comfort sets; nothing else defines a token), `base.css` (shared `rt-*` pieces), `flashcards.css` (components), `cards.css` (the index-card look), `motion.css` (all motion, the Motion setting's `data-motion` rules).
- `src/components/motion/` — `CountUp`, `Confetti`, `SetTitle` (view-transition name), `useFlip` (lists glide). Screens slide via `<ViewTransition>` in `App.tsx`; `Link` tags the direction and primes the next screen's data (`lib/app/prime.ts`).
- `/dev/motion` (`src/screens/MotionLab.tsx`, dev builds only) — every animation on one screen, with replay buttons.

## Conventions
- Card text only ever goes into SQL as a bound `?` parameter. `db.rs` refuses ATTACH/VACUUM/PRAGMA from the UI.
- The UI never names a file path or URL for Rust to use: files go through native dialogs in Rust, links through the `open_link` allow-list.
- User settings live in `settings.rs` (`settings.json`, tmp + rename), never in localStorage: WebView2 drops recent writes when the tray app is killed at a restart. localStorage holds only caches and bookkeeping (theme flash cache, reminder/backup dates).
- Unfinished study rounds live in the `study_sessions` table (one row per set and mode), as card ids plus per-card state in the shapes of `src/lib/flashcards/saved.ts`, not card text (only the answer on screen as typed or picked): loading rebuilds them from the set, dropping cards deleted since. Save through `saveDeck`/`saveWrite`/`saveLearn` in `client.ts` (queued in order, announced as data changes); change a stored shape only with a reader for the old one.
- Schema changes: add `src-tauri/schema/00N_*.sql`, list it in `db.rs` MIGRATIONS and in `src/lib/store/testDb.ts`. Never edit a shipped step.
- No `window.confirm/prompt` (WKWebView): use `ask` from `src/components/Dialogs.tsx`.
- Motion: Settings → Motion is full / calm / off (`data-motion` on <html>). Off stills everything; calm drops `.fx-big` effects and screen slides. Effects run from script ask `motionLevel()` (`lib/app/theme.ts`). Never make input wait for an animation: a new press finishes the running one. Animate with `translate`/`scale` properties where the element's `transform` is written by script (the deck's drag).
- Identifier `com.gaggi32.flashcards`. Up to 0.1.6 it was `ch.404canvas.flashcards`: on start, `adopt_old_folders` (lib.rs) renames the old data/webview folders, `ai.rs` moves the key to the new credential name, and `src-tauri/nsis-hooks.nsh` copies the installer's old `Software\404canvas\Flashcards` key to `Software\gaggi32\Flashcards` before the first page (NSIS finds the install to uninstall through `Software\<publisher>\<product>`; hooks are read before the template's `!define`s, so names are spelled out there). Keep those until nobody runs 0.1.6. Never change `bundle.publisher` again without the same kind of carry-over.
- The update check reads `api.github.com/repos/gaggi32/flashcards/releases/latest` (no token), so it needs the repo to be public.
- Version lives in three places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. The release job refuses a tag that does not match all three.

## Releasing
Add the version's section to `CHANGELOG.md` (newest first, Added / Changed / Fixed / Removed, written for users, one line per change, matching the commits since the last tag), bump the three versions, commit, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` refuses a tag whose CHANGELOG section is missing (`.github/changelog_notes.py`, which also writes the release notes), builds Windows x64 + macOS arm64/x64 signed for the updater, uploads installers, `.sha256`, `.sig` and `latest.json`, and publishes. The app's update check and its in-app updater (`install_update`, endpoint `releases/latest/download/latest.json`) read that release.
Updater key: `C:\Users\miche\.tauri\flashcards-updater.key` and `.password` (never in the repo or the vault), stored as repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is `plugins.updater.pubkey` in `tauri.conf.json`. Builds signed with another key are refused by installed apps, so losing it means everyone installs by hand once more.
After it is published, point the 404canvas download at it: `C:\dev\404canvas\private\release-flashcards.json` (version, the three asset URLs, SHA-256 from the release's `.sha256` files), commit "release: Flashcards vX.Y.Z", push. Installs from before 0.1.7 ask that site for updates.

## Only Michele can do
- Keep the repo public (the update check reads its releases without a token).
- Code signing certificates (Apple Developer ID, Windows signing) if wanted.
- Keep a backup of the updater key and its password (a password manager), and set the two repo secrets from them.
