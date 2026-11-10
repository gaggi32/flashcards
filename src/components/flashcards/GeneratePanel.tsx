
import { useEffect, useId, useRef, useState } from 'react';

import { ApiError, errorMessage, generateCards } from '@/lib/flashcards/client';
import { plural } from '@/lib/flashcards/format';
import { preparePhoto } from '@/lib/image';
import type { AiKeyStatus, AiUsage, KeySource } from '@/lib/openrouter/types';
import { formatUsd } from '@/lib/openrouter/format';
import {
  AI_LIMITS,
  GENERATE_COUNTS,
  LIMITS,
  type GenerateCount,
  type GenerateResult,
  type GeneratedCard,
} from '@/lib/flashcards/types';
import { AiKeyPanel, effectiveBalance } from './AiKeyPanel';
import { AiReceipt } from './AiReceipt';
import { IconClose, IconPlus } from './FlashcardIcons';

/**
 * Screenshots are text, not scenery: budgeted by area rather than capped at a
 * short edge, so a tall scrolling capture keeps writing large enough to read.
 * ~2 MP at this quality stays around half a megabyte a shot.
 */
const SCREENSHOT_PREP = { maxEdge: 4096, maxPixels: 2_000_000, quality: 0.85 };

const COUNT_LABELS: Record<GenerateCount, string> = {
  auto: 'as many as fit',
  '10': 'about 10',
  '20': 'about 20',
  '40': 'about 40',
};

type Shot = { key: string; blob: Blob; url: string };

export type GeneratedReceipt = {
  model: string | null;
  usage: AiUsage | null;
  billedTo: KeySource | null;
};

type Phase =
  | { kind: 'input' }
  | { kind: 'working' }
  /** `cards` starts as the result's and takes the edits made while reviewing. */
  | { kind: 'review'; result: GenerateResult; cards: GeneratedCard[]; picked: boolean[] };

let shotSeq = 0;

/**
 * Screenshots and/or text → draft cards → the editor.
 *
 * Nothing is saved from here. Picked cards land in the editor as ordinary
 * rows, the same way an import does, so they are read and fixed before they
 * become a set. Like the key panel, this renders inside the editor's <form>,
 * so it has no form of its own and Enter is handled by hand.
 */
export function GeneratePanel({
  model,
  onAdd,
  onClose,
}: {
  model: string;
  onAdd: (cards: GeneratedCard[], title: string | null, receipt: GeneratedReceipt) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [text, setText] = useState('');
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState<GenerateCount>('auto');
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed call the model already answered is still billed; say so.
  const [errorReceipt, setErrorReceipt] = useState<GeneratedReceipt | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Object URLs outlive the component unless revoked.
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.url)), []);

  async function addFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) {
      if (files.length > 0) setError('Only images can be added here — paste text into the box.');
      return;
    }
    const room = AI_LIMITS.images - shotsRef.current.length;
    if (room <= 0) {
      setError(`At most ${AI_LIMITS.images} screenshots at once.`);
      return;
    }

    setError(null);
    setPreparing(true);
    try {
      const prepared = await Promise.all(
        images.slice(0, room).map(async (file) => {
          const blob = await preparePhoto(file, SCREENSHOT_PREP);
          shotSeq += 1;
          return { key: `shot-${shotSeq}`, blob, url: URL.createObjectURL(blob) };
        }),
      );
      setShots((prev) => [...prev, ...prepared]);
      if (images.length > room) {
        setError(`Only the first ${room} added — at most ${AI_LIMITS.images} screenshots at once.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.');
    } finally {
      setPreparing(false);
    }
  }

  function removeShot(key: string) {
    setShots((prev) => {
      const gone = prev.find((shot) => shot.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((shot) => shot.key !== key);
    });
  }

  // Ctrl/Cmd+V a screenshot straight from the clipboard, wherever focus is.
  // Only when the clipboard holds an image and no text: copying from a word
  // processor carries both, and there the text is what was meant.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const acceptingPaste = phase.kind === 'input' && keyStatus !== null && keyStatus.source !== 'none';
  useEffect(() => {
    if (!acceptingPaste) return;
    function onPaste(e: ClipboardEvent) {
      const data = e.clipboardData;
      if (!data || data.getData('text/plain')) return;
      const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
      if (files.length === 0) return;
      e.preventDefault();
      void addFilesRef.current(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptingPaste]);

  const totalBytes = shots.reduce((sum, shot) => sum + shot.blob.size, 0);
  const trimmedText = text.trim();
  const tooLong = trimmedText.length > AI_LIMITS.textLength;
  const canGenerate =
    (shots.length > 0 || trimmedText !== '') && !tooLong && !preparing && phase.kind === 'input';

  async function generate() {
    if (!canGenerate) return;
    if (totalBytes > AI_LIMITS.totalImageBytes) {
      setError('Those screenshots are too large together. Remove one and try again.');
      return;
    }
    setError(null);
    setErrorReceipt(null);
    setPhase({ kind: 'working' });
    try {
      const result = await generateCards({
        images: shots.map((shot) => shot.blob),
        text,
        focus,
        count,
      });
      setPhase({
        kind: 'review',
        result,
        cards: result.cards,
        picked: result.cards.map(() => true),
      });
    } catch (err) {
      setPhase({ kind: 'input' });
      setError(errorMessage(err, 'Could not generate cards.'));
      if (err instanceof ApiError && ('usage' in err.body || 'model' in err.body)) {
        setErrorReceipt({
          model: typeof err.body.model === 'string' ? err.body.model : null,
          usage: (err.body.usage as AiUsage | null | undefined) ?? null,
          billedTo: (err.body.billedTo as KeySource | undefined) ?? null,
        });
      }
    }
  }

  function add() {
    if (phase.kind !== 'review') return;
    // A card edited down to nothing is as good as unticked.
    const cards = phase.cards.filter(
      (card, i) => phase.picked[i] && (card.term.trim() !== '' || card.definition.trim() !== ''),
    );
    if (cards.length === 0) return;
    onAdd(cards, phase.result.title, {
      model: phase.result.model,
      usage: phase.result.usage,
      billedTo: phase.result.billedTo,
    });
  }

  const noKey = keyStatus?.source === 'none';
  const left = effectiveBalance(keyStatus);

  return (
    <section className="fc-panel fc-generate" aria-labelledby={`${uid}-title`}>
      <div className="fc-panel__head">
        <h2 id={`${uid}-title`} className="fc-panel__title">
          generate with ai
        </h2>
        {phase.kind !== 'working' && (
          <button type="button" className="rt-linkbtn" onClick={onClose}>
            close
          </button>
        )}
      </div>

      {/* Mounted throughout: it reads the key status the rest of the panel keys off. */}
      <div hidden={!noKey}>
        <p className="rt-small fc-generate__nokey">
          Generating cards runs on your own OpenRouter key, so the cost lands on your account. Add
          one to start — it is saved for the food log too.
        </p>
        <AiKeyPanel model={model} onStatus={setKeyStatus} intro={false} />
      </div>

      {keyStatus === null && (
        <div className="fc-skel" style={{ height: 120 }} aria-busy="true" aria-label="Loading" />
      )}

      {keyStatus !== null && !noKey && phase.kind !== 'review' && (
        <>
          <div className="rt-small fc-generate__billing">
            <code className="rt-mono">{model}</code> ·{' '}
            {keyStatus.source === 'user' ? `your key ····${keyStatus.hint}` : 'site key'}
            {left !== null && ` · ${formatUsd(left)} left`}
          </div>

          <div
            className={`fc-drop${dragging ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(Array.from(e.dataTransfer.files));
            }}
          >
            {shots.length > 0 && (
              <ul className="fc-shots">
                {shots.map((shot, i) => (
                  <li key={shot.key} className="fc-shot">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */}
                    <img src={shot.url} alt={`Screenshot ${i + 1}`} />
                    <button
                      type="button"
                      className="fc-iconbtn fc-iconbtn--del fc-shot__del"
                      onClick={() => removeShot(shot.key)}
                      disabled={phase.kind === 'working'}
                      aria-label={`Remove screenshot ${i + 1}`}
                      title="Remove"
                    >
                      <IconClose size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="fc-drop__hint">
              <button
                type="button"
                className="rt-btn rt-btn--sm"
                onClick={() => fileRef.current?.click()}
                disabled={shots.length >= AI_LIMITS.images || phase.kind === 'working'}
              >
                {preparing ? (
                  'reading…'
                ) : (
                  <>
                    <IconPlus />
                    Screenshot
                  </>
                )}
              </button>
              <span className="rt-small">
                or drop or paste one here · up to {AI_LIMITS.images}
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                // Picking the same file again should still fire a change.
                e.target.value = '';
              }}
            />
          </div>

          <label className="rt-field">
            <span className="rt-field__label">
              <span>text — notes, a glossary, a chapter</span>
              <span className={tooLong ? 'fc-over' : 'rt-small'}>
                {trimmedText.length.toLocaleString('en')} / {AI_LIMITS.textLength.toLocaleString('en')}
              </span>
            </span>
            <textarea
              className="rt-input fc-generate__text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={phase.kind === 'working'}
              placeholder="Paste study material here, add screenshots above, or both."
            />
          </label>

          <div className="fc-generate__opts">
            <label className="rt-field">
              <span className="rt-field__label">
                focus <span className="rt-small">optional</span>
              </span>
              <input
                className="rt-input"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void generate();
                  }
                }}
                maxLength={AI_LIMITS.focusLength}
                disabled={phase.kind === 'working'}
                placeholder="e.g. only the dates · definitions in English"
              />
            </label>
            <label className="rt-field">
              <span className="rt-field__label">cards</span>
              <select
                className="rt-input"
                value={count}
                onChange={(e) => setCount(e.target.value as GenerateCount)}
                disabled={phase.kind === 'working'}
              >
                {GENERATE_COUNTS.map((value) => (
                  <option key={value} value={value}>
                    {COUNT_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <div className="rt-note rt-note--err" role="alert">
              {error}
              {errorReceipt && <AiReceipt {...errorReceipt} />}
            </div>
          )}

          <div className="rt-btnrow">
            <button
              type="button"
              className="rt-btn rt-btn--primary"
              onClick={() => void generate()}
              disabled={!canGenerate}
            >
              {phase.kind === 'working' ? (
                <>
                  <span className="fc-spinner" aria-hidden="true" /> Generating…
                </>
              ) : (
                'generate cards'
              )}
            </button>
            {phase.kind === 'working' ? (
              <span className="rt-small" role="status">
                Reading the material — this can take up to a minute.
              </span>
            ) : (
              <button type="button" className="rt-btn" onClick={onClose}>
                cancel
              </button>
            )}
          </div>
        </>
      )}

      {phase.kind === 'review' && (
        <Review
          phase={phase}
          onToggle={(i) =>
            setPhase({
              ...phase,
              picked: phase.picked.map((on, j) => (j === i ? !on : on)),
            })
          }
          onEdit={(i, field, value) =>
            setPhase((prev) =>
              prev.kind !== 'review'
                ? prev
                : {
                    ...prev,
                    cards: prev.cards.map((card, j) => (j === i ? { ...card, [field]: value } : card)),
                    // Fixing a card means keeping it.
                    picked: prev.picked.map((on, j) => on || j === i),
                  },
            )
          }
          onAll={(on) => setPhase({ ...phase, picked: phase.picked.map(() => on) })}
          onBack={() => setPhase({ kind: 'input' })}
          onAdd={add}
        />
      )}
    </section>
  );
}

function Review({
  phase,
  onToggle,
  onEdit,
  onAll,
  onBack,
  onAdd,
}: {
  phase: Extract<Phase, { kind: 'review' }>;
  onToggle: (index: number) => void;
  onEdit: (index: number, field: keyof GeneratedCard, value: string) => void;
  onAll: (on: boolean) => void;
  onBack: () => void;
  onAdd: () => void;
}) {
  const { result, cards, picked } = phase;
  const pickedCount = picked.filter(Boolean).length;
  const allOn = pickedCount === cards.length;

  return (
    <>
      <div className="rt-note rt-note--ok fc-generate__done" role="status">
        <div className="rt-note__title">
          {plural(result.cards.length, 'card')} generated
          {result.title && <> · “{result.title}”</>}
        </div>
        <AiReceipt model={result.model} usage={result.usage} billedTo={result.billedTo} />
      </div>

      <div className="fc-generate__pickhead">
        <span className="rt-small">
          Fix anything off right here, or untick it to leave it out.
        </span>
        <button type="button" className="rt-linkbtn" onClick={() => onAll(!allOn)}>
          {allOn ? 'untick all' : 'tick all'}
        </button>
      </div>

      <ol className="fc-terms fc-terms--compact fc-picklist">
        {cards.map((card, i) => (
          <li key={i} className={`fc-pick${picked[i] ? '' : ' is-off'}`}>
            <input
              type="checkbox"
              className="fc-pick__check"
              checked={picked[i]}
              onChange={() => onToggle(i)}
              aria-label={`Keep card ${i + 1}`}
            />
            <textarea
              className="rt-input fc-textarea fc-pick__field fc-pick__term"
              rows={1}
              value={card.term}
              onChange={(e) => onEdit(i, 'term', e.target.value)}
              maxLength={LIMITS.sideLength}
              aria-label={`Card ${i + 1} term`}
            />
            <textarea
              className="rt-input fc-textarea fc-pick__field fc-pick__def"
              rows={1}
              value={card.definition}
              onChange={(e) => onEdit(i, 'definition', e.target.value)}
              maxLength={LIMITS.sideLength}
              aria-label={`Card ${i + 1} definition`}
            />
          </li>
        ))}
      </ol>

      <div className="rt-btnrow">
        <button
          type="button"
          className="rt-btn rt-btn--primary"
          onClick={onAdd}
          disabled={pickedCount === 0}
        >
          add {plural(pickedCount, 'card')}
        </button>
        <button type="button" className="rt-btn" onClick={onBack}>
          back
        </button>
      </div>
    </>
  );
}
