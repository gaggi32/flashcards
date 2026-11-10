# Flashcards

The flashcards from [404canvas.ch](https://404canvas.ch), as a desktop app for
Windows and macOS. Your sets live on your own computer, and a hotkey brings up
a small study card over whatever you are doing.

Built with Tauri v2 (Rust), React and TypeScript, on a local SQLite database.

## What it does

- **Hotkey overlay.** <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>
  (<kbd>⌘</kbd>+<kbd>⌥</kbd>+<kbd>F</kbd> on macOS) shows the cards that are due,
  then a few new ones. <kbd>Space</kbd> flips a card; <kbd>1</kbd>–<kbd>4</kbd>
  grade it (again / hard / good / easy); <kbd>A</kbd> adds a card;
  <kbd>Esc</kbd> hides the overlay. The hotkey can be changed in Settings.
- **Every study mode from the site.** Flashcards, Write, Learn, the set editor,
  importing a pasted list, folders, and AI generation from screenshots or text.
- **Spaced repetition.** Every answer updates an SM-2 schedule; the overlay
  works from it.
- **Settings.** Cards per round, new cards per round, which side shows first,
  hide when you click away, stay on top of fullscreen apps, daily goal, a daily
  reminder, theme and eye comfort, the AI model, daily backups, export and
  import, start with the computer, and update checks.
- **Moving from the website.** On 404canvas.ch, *export your sets*, then in the
  app open Settings → Data → Import. Your study progress comes with them.

## Privacy and security

- Nothing is synced. The database is `flashcards.db` in the app data folder
  (Settings → Data → Open).
- The OpenRouter key (optional, used only for AI generation) is stored in
  Windows Credential Manager or the macOS Keychain. The UI never reads it back,
  and Rust only sends it to `openrouter.ai`.
- The app loads no remote pages. A strict content security policy is set,
  navigation away from the app is blocked, and links open in your browser only
  for an allow-list of hosts.
- File access happens only through native open and save dialogs.
- The update check asks `404canvas.ch` for a version number and nothing else.
  Installing an update is always your own download from the site.

## Development

See [CLAUDE.md](CLAUDE.md) for the commands, the layout and how to release.
