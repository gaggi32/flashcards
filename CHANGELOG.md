# Changelog

All notable changes to Flashcards (desktop). Versions match the GitHub releases.

## [0.1.19] — 2026-11-16
### Added
- Share a single set as a file, and open a set someone sent you.
### Fixed
- Removed the Ctrl+S shortcut from study.
- Resetting Write asks for the side again.

## [0.1.18] — 2026-11-16
### Added
- Switch between term and definition mid-round; each set remembers its side.
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
- Unfinished study rounds are stored in SQLite instead of localStorage.
- Study preferences are stored in `settings.json` instead of localStorage.

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
- Long text and corrections fit in the overlay without scrolling.

## [0.1.5] — 2026-11-11
### Changed
- Compact overlay: a small window rather than a second main window.
- Overlay runs the main window's modes on the same sessions.

## [0.1.4] — 2026-11-11
### Added
- Overlay: one set at a time, sides as on the website, all-cards rounds.

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
