// Settings, in the same sections Lingo and Dash use: overlay, study,
// reminders, look, AI, data, system.

import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import Link from '@/components/Link';
import { ask } from '@/components/Dialogs';
import { AiKeyPanel } from '@/components/flashcards/AiKeyPanel';
import { IconChevronLeft } from '@/components/flashcards/FlashcardIcons';
import { latestUpdate, onUpdate } from '@/lib/app/background';
import { announceDataChange } from '@/lib/app/events';
import { eventToChord, formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import {
  appInfo,
  backupNow,
  checkUpdate,
  exportFile,
  importFile,
  openDataFolder,
  openDownloadPage,
  resumeHotkey,
  stampNow,
  suspendHotkey,
  type AppInfo,
  type Settings,
  type UpdateInfo,
} from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';
import { asApiError } from '@/lib/store/errors';
import { exportAll, importAll, parseExport } from '@/lib/store/transfer';

export const DEFAULT_MODEL = 'google/gemini-3.8-flash';

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section className="rt-section set-section" id={id}>
      <div className="rt-label">{title}</div>
      <div className="fc-panel set-panel">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <div className="set-row__label">{label}</div>
        {hint && <div className="rt-small rt-ink-faint">{hint}</div>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`rt-switch${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="rt-switch__knob" aria-hidden="true" />
      <span className="rt-switch__text">{on ? 'on' : 'off'}</span>
    </button>
  );
}

function NumberField({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className="rt-input set-num"
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Math.round(Number(draft));
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        else setDraft(String(value));
      }}
    />
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="set-choice" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={`rt-btn rt-btn--sm${value === v ? ' rt-btn--primary' : ''}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function HotkeyRecorder({ value, onSave }: { value: string; onSave: (accelerator: string) => Promise<void> }) {
  const isMac = isMacPlatform();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  async function start() {
    setError(null);
    setPreview('');
    // Release the current hotkey, or the OS swallows it before we see it.
    await suspendHotkey().catch(() => {});
    setRecording(true);
    ref.current?.focus();
  }

  async function stop(next?: string) {
    setRecording(false);
    if (!next) {
      await resumeHotkey().catch(() => {});
      return;
    }
    try {
      await onSave(next);
    } catch (err) {
      setError(asApiError(err).message);
      await resumeHotkey().catch(() => {});
    }
  }

  return (
    <div className="set-hotkey">
      <button
        ref={ref}
        type="button"
        className={`rt-btn rt-btn--sm set-hotkey__btn${recording ? ' is-recording' : ''}`}
        onClick={() => (recording ? void stop() : void start())}
        onBlur={() => recording && void stop()}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') return void stop();
          const chord = eventToChord(e.nativeEvent, isMac);
          setPreview(chord.accelerator);
          if (chord.complete) {
            if (!chord.hasModifier) {
              setError('Add Ctrl, Alt, Shift or ⌘ — a single key would fire while you type.');
              return;
            }
            void stop(chord.accelerator);
          }
        }}
      >
        {recording ? (preview ? formatHotkey(preview, isMac) : 'press keys…') : formatHotkey(value, isMac)}
      </button>
      {recording && <span className="rt-small rt-ink-faint">Esc cancels</span>}
      {error && <div className="rt-small rt-rust">{error}</div>}
    </div>
  );
}

export function SettingsScreen() {
  const { settings, save } = useSettings();
  const location = useLocation();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(latestUpdate());
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string; at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [model, setModel] = useState('');

  useEffect(() => {
    appInfo().then(setInfo).catch(() => {});
    autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
    return onUpdate(setUpdate);
  }, []);
  useEffect(() => setModel(settings?.aiModel ?? ''), [settings?.aiModel]);

  // /settings#data from the empty sets list or the tray.
  useEffect(() => {
    const id = location.hash.replace('#', '');
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [location.hash, settings]);

  if (!settings) return <main className="rt-boot"><div className="fc-skel" style={{ height: 200 }} /></main>;
  const s = settings;

  async function patch(changes: Partial<Settings>, at = 'general') {
    try {
      await save({ ...s, ...changes });
    } catch (err) {
      setNote({ kind: 'err', text: asApiError(err).message, at });
    }
  }

  function say(at: string, kind: 'ok' | 'err', text: string) {
    setNote({ at, kind, text });
  }
  const noteFor = (at: string) =>
    note?.at === at ? <div className={`rt-note rt-note--${note.kind} set-note`}>{note.text}</div> : null;

  async function doImport() {
    setBusy('import');
    try {
      const text = await importFile('json');
      if (text === null) return;
      const file = parseExport(text);
      const cards = file.sets.reduce((n, x) => n + x.cards.length, 0);
      const yes = await ask.confirm(
        `Add ${file.sets.length} set${file.sets.length === 1 ? '' : 's'} with ${cards} cards? Your current sets stay as they are.`,
        { ok: 'import' },
      );
      if (!yes) return;
      const res = await importAll(file);
      announceDataChange();
      say('data', 'ok', `Imported ${res.sets} sets and ${res.cards} cards (${res.withProgress} with study progress).`);
    } catch (err) {
      say('data', 'err', asApiError(err, 'Could not import that file.').message);
    } finally {
      setBusy(null);
    }
  }

  async function doExport() {
    setBusy('export');
    try {
      const data = await exportAll();
      const where = await exportFile(JSON.stringify(data, null, 1), `flashcards-${stampNow().slice(0, 8)}.json`);
      if (where) say('data', 'ok', `Saved to ${where}`);
    } catch (err) {
      say('data', 'err', asApiError(err, 'Could not export.').message);
    } finally {
      setBusy(null);
    }
  }

  async function doBackup() {
    setBusy('backup');
    try {
      const where = await backupNow(stampNow());
      say('data', 'ok', `Backup written: ${where}`);
    } catch (err) {
      say('data', 'err', asApiError(err, 'Could not write a backup.').message);
    } finally {
      setBusy(null);
    }
  }

  async function doCheck() {
    setChecking(true);
    try {
      setUpdate(await checkUpdate());
    } catch (err) {
      say('system', 'err', asApiError(err).message);
    } finally {
      setChecking(false);
    }
  }

  async function toggleAutostart(on: boolean) {
    try {
      if (on) await enableAutostart();
      else await disableAutostart();
      setAutostart(await autostartEnabled());
    } catch (err) {
      say('system', 'err', asApiError(err, 'Could not change the login item.').message);
    }
  }

  const isMac = info?.platform === 'macos';

  return (
    <main className="rt-boot settings">
      <Link href="/flashcards" className="rt-backlink">
        <IconChevronLeft />
        All sets
      </Link>
      <div className="rt-pagehead">
        <h1>settings</h1>
      </div>
      {noteFor('general')}

      <Section title="overlay">
        <Row label="Hotkey" hint="Opens the study overlay from any app. Pressing it again hides it.">
          <HotkeyRecorder value={s.hotkey} onSave={async (hotkey) => void (await save({ ...s, hotkey }))} />
        </Row>
        <Row label="Cards per round" hint="How many cards one overlay round shows.">
          <NumberField label="Cards per round" value={s.overlayRound} min={1} max={50} onChange={(n) => patch({ overlayRound: n })} />
        </Row>
        <Row label="New cards per round" hint="Never-studied cards in a round, after the ones you are still learning. 0 = none.">
          <NumberField label="New cards per round" value={s.overlayNewCards} min={0} max={50} onChange={(n) => patch({ overlayNewCards: n })} />
        </Row>
        <Row label="Show first">
          <Choice
            label="Show first"
            value={s.overlayFront}
            onChange={(v) => patch({ overlayFront: v })}
            options={[
              ['term', 'term'],
              ['definition', 'definition'],
              ['mixed', 'mixed'],
            ]}
          />
        </Row>
        <Row label="Hide when I click away">
          <Switch label="Hide when I click away" on={s.overlayHideOnBlur} onChange={(v) => patch({ overlayHideOnBlur: v })} />
        </Row>
        <Row label="Stay on top of fullscreen apps" hint="For games and videos that pull themselves back in front.">
          <Switch label="Stay on top of fullscreen apps" on={s.overlayTopmostWatch} onChange={(v) => patch({ overlayTopmostWatch: v })} />
        </Row>
        <p className="rt-small rt-ink-faint set-foot">
          Which sets feed the overlay is set on each set&apos;s page.
        </p>
      </Section>

      <Section title="reminders">
        <Row label="Remind me" hint="One notification, if you have not studied yet that day and cards are still to learn.">
          <Switch label="Remind me" on={s.reminders} onChange={(v) => patch({ reminders: v })} />
        </Row>
        <Row label="At">
          <input
            className="rt-input set-time"
            type="time"
            aria-label="Reminder time"
            value={s.reminderTime}
            disabled={!s.reminders}
            onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && patch({ reminderTime: e.target.value })}
          />
        </Row>
      </Section>

      <Section title="look">
        <Row label="Theme">
          <Choice
            label="Theme"
            value={s.theme}
            onChange={(v) => patch({ theme: v })}
            options={[
              ['system', 'system'],
              ['light', 'paper'],
              ['dark', 'night'],
            ]}
          />
        </Row>
        <Row label="Eye comfort" hint="Warmer colours, less blue light and softer contrast.">
          <Switch label="Eye comfort" on={s.eyeComfort} onChange={(v) => patch({ eyeComfort: v })} />
        </Row>
      </Section>

      <Section id="ai" title="AI card generator">
        <AiKeyPanel model={s.aiModel} />
        <Row label="Model" hint="Any OpenRouter model slug that reads images and answers in JSON.">
          <form
            className="set-model"
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ aiModel: model.trim() || DEFAULT_MODEL }, 'ai');
            }}
          >
            <input className="rt-input" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
            <button type="submit" className="rt-btn rt-btn--sm" disabled={model.trim() === s.aiModel}>
              save
            </button>
          </form>
        </Row>
        {noteFor('ai')}
        <p className="rt-small rt-ink-faint set-foot">
          The key is kept in {isMac ? 'the macOS Keychain' : 'Windows Credential Manager'} and only ever sent to
          openrouter.ai. Nothing else leaves this computer.
        </p>
      </Section>

      <Section id="data" title="data">
        <Row
          label="Import"
          hint={
            <>
              A Flashcards export — from this app, or from <strong>404canvas.ch → Flashcards → export for the desktop app</strong>.
              Adds the sets; nothing is overwritten.
            </>
          }
        >
          <button type="button" className="rt-btn rt-btn--sm" disabled={busy !== null} onClick={doImport}>
            {busy === 'import' ? 'importing…' : 'import file…'}
          </button>
        </Row>
        <Row label="Export" hint="Every set, card and its study progress, as one JSON file.">
          <button type="button" className="rt-btn rt-btn--sm" disabled={busy !== null} onClick={doExport}>
            {busy === 'export' ? 'exporting…' : 'export…'}
          </button>
        </Row>
        <Row label="Daily backup" hint="A copy of the database once a day, in the app's backups folder.">
          <Switch label="Daily backup" on={s.autoBackup} onChange={(v) => patch({ autoBackup: v })} />
        </Row>
        <Row label="Backups to keep">
          <NumberField label="Backups to keep" value={s.backupsKept} min={1} max={90} onChange={(n) => patch({ backupsKept: n })} />
        </Row>
        <Row label="Back up now">
          <button type="button" className="rt-btn rt-btn--sm" disabled={busy !== null} onClick={doBackup}>
            {busy === 'backup' ? 'saving…' : 'back up'}
          </button>
        </Row>
        <Row label="Data folder" hint={<span className="rt-mono set-path">{info?.dataDir}</span>}>
          <button type="button" className="rt-btn rt-btn--sm" onClick={() => void openDataFolder()}>
            open
          </button>
        </Row>
        {noteFor('data')}
      </Section>

      <Section id="updates" title="system">
        <Row label="Start with the computer" hint="Starts quietly in the tray, so the hotkey always works.">
          <Switch label="Start with the computer" on={autostart === true} disabled={autostart === null} onChange={toggleAutostart} />
        </Row>
        <Row label="Check for updates" hint="Asks 404canvas.ch for the newest version number twice a day. Nothing is downloaded.">
          <Switch label="Check for updates" on={s.checkUpdates} onChange={(v) => patch({ checkUpdates: v })} />
        </Row>
        <Row
          label={`Version ${info?.version ?? ''}`}
          hint={
            update
              ? update.newer
                ? `Version ${update.latest} is available.`
                : 'You have the newest version.'
              : 'Not checked yet.'
          }
        >
          <div className="rt-btnrow">
            <button type="button" className="rt-btn rt-btn--sm" disabled={checking} onClick={doCheck}>
              {checking ? 'checking…' : 'check now'}
            </button>
            {update?.newer && (
              <button type="button" className="rt-btn rt-btn--sm rt-btn--primary" onClick={() => void openDownloadPage()}>
                get {update.latest}
              </button>
            )}
          </div>
        </Row>
        {noteFor('system')}
      </Section>
    </main>
  );
}
