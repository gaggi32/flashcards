# Changelog

All notable changes to Flashcards (desktop). Versions match the GitHub releases.

## [1.4.0] — 2026-11-18
### Added
- Test in the overlay: a fourth tab (Ctrl+4) next to Cards, Write and Learn. The panel keeps its size and the test scrolls inside it.
### Changed
- A test mixes its kinds of question instead of asking all of one kind and then the next. Each question shows which kind it is.
### Fixed
- After going from a set to Test and back to the set, the back link returned to Test instead of leaving the set.

## [1.3.2] — 2026-11-17
### Fixed
- The settings cog no longer hops a pixel when it starts or stops turning.

## [1.3.1] — 2026-11-17
### Changed
- The "What's new" card is easier to read: coloured New, Improved and Fixed labels, a bullet per change, and older versions folded to one line each. The update notes in Settings look the same.
### Fixed
- The settings cog turns one tooth when you point at it and no longer jumps when the mouse leaves.

## [1.3.0] — 2026-11-17
### Added
- Test: a new study mode that puts a set on one paper of true or false, multiple choice, matching and written questions. Pick how many questions and which kinds, answer them in any order, and hand it in to see your score with every answer marked. Then test only the cards you missed.
- Before you install an update, Settings lists what is new in every version you would get, not only the newest.
### Changed
- The "What's new" card after an update can show every version you skipped, not only the last three.
### Fixed
- The settings cog no longer jumps slightly when the mouse leaves it.

## [1.2.0] — 2026-11-17
### Added
- Drag a set from the sets page out of the window to get its file: onto the desktop, into a folder or into a mail. Dragging it onto a folder in the app still files it there.
### Fixed
- After opening a set from another set (for example by dropping a set file while one was open), the back links sent you between the two sets and never back to your sets. They now always lead back out.
- A file dropped on the set editor adds the set without leaving the editor, so unsaved changes stay.
- Pictures dragged over the window no longer show the "drop to add the set" prompt, and the prompt can no longer stay stuck on screen.

## [1.1.0] — 2026-11-17
### Added
- Drop a Flashcards file (a shared set or an export) anywhere on the window to add it, the same as "Open shared set". Inside a folder, it goes into that folder.
### Changed
- Settings is a cog icon in the top bar.

## [1.0.0] — 2026-11-17
### Added
- Drag a set from the sets page onto a folder to put it there; inside a folder, drag it onto "My sets" to take it out again.
### Changed
- Flashcards is 1.0: its first stable version.

## [0.1.21] — 2026-11-17
### Added
- "New folder" on the sets page makes an empty folder and opens it, ready for its first set.
### Changed
- A folder stays when its last set moves out; "remove folder" takes it away.

## [0.1.20] — 2026-11-17
### Added
- Install updates from inside the app: Settings → "install" downloads the new version, checks it is signed by Flashcards, installs it and restarts. No browser download needed. (This version itself is the last one to install by hand.)
- "What's new": after an update, a short card in the main window lists what changed since the version you had.
- Settings shows what is new in an available update before you install it.
### Changed
- The set pickers (overlay, quick add, "The overlay studies") list sets under their folders, then the ones in no folder.
- New installs keep the last 7 daily backups instead of 14; an existing setting stays as it is.
- The release pages on GitHub list the changes from this changelog.

## [0.1.19] — 2026-11-16
### Added
- Share a single set as a file ("share…" on the set page), and open a set someone sent you ("Open shared set" on the sets page). Your study progress is not in the file.
### Changed
- Resetting Write goes back to its start screen and asks which side to answer with again.
### Removed
- The Ctrl+S shortcut for switching sides; the button stays.

## [0.1.18] — 2026-11-16
### Added
- Switch between term and definition mid-round in Write and Learn; each set remembers its side for the next round.
### Fixed
- A set's back link returns to the page before it, including folders.

## [0.1.17] — 2026-11-16
### Fixed
- Windows: a panel shown over the main window no longer freezes on its first frame.

## [0.1.16] — 2026-11-16
### Added
- Answer check setting: exact or easier.
### Fixed
- Spaces next to punctuation and inside brackets are judged consistently.
- A hotkey press meant to open the overlay no longer plays the exit animation.

## [0.1.15] — 2026-11-16
### Fixed
- Study preferences no longer reset themselves after a PC restart (kept in `settings.json`, not the webview's storage).
- Unfinished rounds survive a restart (kept in the database); rounds from earlier versions are carried over once.

## [0.1.14] — 2026-11-15
### Added
- Overlay window fits its content, scales with the screen, and has a size setting.

## [0.1.13] — 2026-11-14
### Fixed
- Enter on a focused button does what the button says ("I was correct" no longer skips the card).

## [0.1.12] — 2026-11-13
### Fixed
- A missing or extra space between words counts as wrong.

## [0.1.11] — 2026-11-12
### Added
- Reset progress per mode from the study bar; resetting Learn leaves Flashcards and Write alone.

## [0.1.10] — 2026-11-12
### Added
- Reset a set's progress.
### Fixed
- Tab never leaves the overlay.
- Update error clears on retry.

## [0.1.9] — 2026-11-12
### Changed
- Tab cycles through the study buttons instead of jumping to the mode tabs.

## [0.1.8] — 2026-11-12
### Fixed
- A missing or extra hyphen counts as wrong.

## [0.1.7] — 2026-11-11
### Changed
- Standalone app: no website; local SQLite store, talks only to GitHub (updates) and OpenRouter (AI).
- App identifier changed to `com.gaggi32.flashcards`; data, AI key and installer registry are carried over from 0.1.6.

## [0.1.6] — 2026-11-11
### Added
- Fairer answer check, with corrections that line up.
### Fixed
- Overlay flips in without flicker.
- Autostart is kept across reinstalls.

## [0.1.5] — 2026-11-11
### Changed
- Compact overlay: a small window rather than a second main window.
### Fixed
- Long text and corrections fit in the overlay without scrolling.

## [0.1.4] — 2026-11-11
### Added
- Overlay: one set at a time, sides as on the website, all-cards rounds.
### Changed
- Overlay runs the main window's modes on the same sessions.

## [0.1.3] — 2026-11-11
### Added
- Overlay: pick a set, coloured swipes, retype misses, special keys, swap sides.

## [0.1.2] — 2026-11-11
### Added
- All three study modes in the overlay, new switches, motion.
### Removed
- Day cycle.

## [0.1.1] — 2026-11-10
### Fixed
- Release build steps run in bash on every runner.

## [0.1.0] — 2026-11-10
### Added
- First release: Flashcards desktop app (Tauri v2), ported from 404canvas.
- Security hardening, release pipeline, docs.
