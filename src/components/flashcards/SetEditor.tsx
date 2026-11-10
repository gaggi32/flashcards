
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { useRouter } from '@/lib/app/router';
import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  addCards,
  createSet,
  errorMessage,
  patchCards,
  updateSet,
  type CardChange,
  type SetMeta,
} from '@/lib/flashcards/client';
import { plural } from '@/lib/flashcards/format';
import { LIMITS, type CardDTO, type SetDTO } from '@/lib/flashcards/types';
import { AiReceipt } from './AiReceipt';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronLeft,
  IconGenerate,
  IconImport,
  IconPlus,
  IconTrash,
} from './FlashcardIcons';
import { GeneratePanel, type GeneratedReceipt } from './GeneratePanel';
import { ImportPanel } from './ImportPanel';
import { SetLoadState, useSet } from './useSet';

type Row = { key: string; id: number | null; term: string; definition: string };
/** The one tool open above the rows, if any. */
export type EditorPanel = 'import' | 'generate' | null;
type AiNotice = GeneratedReceipt & { count: number };
type Saved = Pick<CardDTO, 'term' | 'definition' | 'position'>;

/** Cards per request. Keeps a very large paste well under serverless body limits. */
const CHUNK = 500;
const BLANK_ROWS = 3;

let rowSeq = 0;
function makeRow(card?: { id?: number; term: string; definition: string }): Row {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    id: card?.id ?? null,
    term: card?.term ?? '',
    definition: card?.definition ?? '',
  };
}

const isBlank = (row: Row) => row.term.trim() === '' && row.definition.trim() === '';

/** Create a set (no `setId`) or edit one. Both save through the same card endpoints. */
export function SetEditor({
  setId,
  openPanel = null,
  folder = null,
  aiModel,
}: {
  setId?: number;
  openPanel?: EditorPanel;
  /** A new set made from inside a folder lands in that folder. */
  folder?: string | null;
  /** The model the generator uses, named in its panel. */
  aiModel: string;
}) {
  if (setId === undefined) {
    return <EditorForm initial={null} openPanel={openPanel} folder={folder} aiModel={aiModel} />;
  }
  return <LoadedEditor setId={setId} aiModel={aiModel} />;
}

function LoadedEditor({ setId, aiModel }: { setId: number; aiModel: string }) {
  const { set, error } = useSet(setId);
  if (!set) {
    return (
      <main>
        <SetLoadState error={error} />
      </main>
    );
  }
  // Someone else's public set loads fine for studying, but is not yours to edit.
  if (!set.isOwner) {
    return (
      <main>
        <div className="rt-section">
          <div className="rt-note rt-note--warn">
            <div className="rt-note__title">NOT YOUR SET</div>
            This set is shared in the public library by {set.authorName ?? 'someone else'}. You can
            study it, but only its owner can edit it.
          </div>
          <div className="rt-btnrow" style={{ marginTop: 16 }}>
            <Link href={`/flashcards/${set.id}`} className="rt-btn">
              back to the set
            </Link>
          </div>
        </div>
      </main>
    );
  }
  return <EditorForm initial={set} openPanel={null} aiModel={aiModel} />;
}

function EditorForm({
  initial,
  openPanel,
  folder = null,
  aiModel,
}: {
  initial: SetDTO | null;
  openPanel: EditorPanel;
  folder?: string | null;
  aiModel: string;
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.cards.length > 0
      ? initial.cards.map((card) => makeRow(card))
      : Array.from({ length: BLANK_ROWS }, () => makeRow()),
  );
  const [panel, setPanel] = useState<EditorPanel>(openPanel);
  const [aiNotice, setAiNotice] = useState<AiNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // What the server holds, as of the last request that succeeded. Saving
  // diffs against this rather than against `initial`, so a save that failed
  // halfway can be retried without repeating the half that went through.
  const setIdRef = useRef<number | null>(initial?.id ?? null);
  const savedMeta = useRef<SetMeta | null>(
    initial ? { title: initial.title, description: initial.description } : null,
  );
  const savedCards = useRef(
    new Map<number, Saved>(
      initial?.cards.map((c) => [c.id, { term: c.term, definition: c.definition, position: c.position }]),
    ),
  );

  const isNew = initial === null;
  const backHref = initial ? `/flashcards/${initial.id}` : '/flashcards';
  const filledCount = rows.filter((row) => !isBlank(row)).length;

  // A closed tab is the one exit Next's router cannot intercept.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Move the caret into a row that was just added.
  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`${focusKey}-term`)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  // Any edit may be the fix for the last save's complaint, so the message goes.
  function touch() {
    setDirty(true);
    setError(null);
  }

  function edit(update: (prev: Row[]) => Row[]) {
    setRows(update);
    touch();
  }

  function changeRow(key: string, field: 'term' | 'definition', value: string) {
    edit((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function moveRow(index: number, delta: -1 | 1) {
    edit((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeRow(key: string) {
    edit((prev) => prev.filter((row) => row.key !== key));
  }

  function addRow() {
    const row = makeRow();
    edit((prev) => [...prev, row]);
    setFocusKey(row.key);
  }

  function appendCards(cards: { term: string; definition: string }[]) {
    // Incoming cards take the place of the empty rows a new set starts with.
    edit((prev) => [...prev.filter((row) => !isBlank(row)), ...cards.map((card) => makeRow(card))]);
    setPanel(null);
  }

  function addGenerated(
    cards: { term: string; definition: string }[],
    suggestedTitle: string | null,
    receipt: GeneratedReceipt,
  ) {
    appendCards(cards);
    // A suggestion only ever fills a blank title, never replaces one.
    if (suggestedTitle && !title.trim()) setTitle(suggestedTitle);
    setAiNotice({ ...receipt, count: cards.length });
  }

  function validate(): { cards: (Row & { position: number })[]; meta: SetMeta } | string {
    const meta: SetMeta = { title: title.trim(), description: description.trim() || null };
    if (!meta.title) return 'Give the set a title.';
    if (meta.title.length > LIMITS.titleLength) {
      return `Keep the title under ${LIMITS.titleLength} characters.`;
    }
    if ((meta.description?.length ?? 0) > LIMITS.descriptionLength) {
      return `Keep the description under ${LIMITS.descriptionLength} characters.`;
    }

    const cards: (Row & { position: number })[] = [];
    for (const [i, row] of rows.entries()) {
      if (isBlank(row)) continue;
      const term = row.term.trim();
      const definition = row.definition.trim();
      if (!term || !definition) return `Card ${i + 1} needs both a term and a definition.`;
      if (term.length > LIMITS.sideLength || definition.length > LIMITS.sideLength) {
        return `Card ${i + 1} is over ${LIMITS.sideLength} characters on one side.`;
      }
      cards.push({ ...row, term, definition, position: cards.length });
    }

    if (cards.length === 0) return 'Add at least one card.';
    if (cards.length > LIMITS.cardsPerSet) {
      return `A set holds at most ${LIMITS.cardsPerSet} cards — this has ${cards.length}.`;
    }
    return { cards, meta };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const checked = validate();
    if (typeof checked === 'string') {
      setError(checked);
      return;
    }
    const { cards, meta } = checked;

    setError(null);
    setSaving(true);
    try {
      // 1. The set itself. Once created, the id sticks: a retry after a
      //    failure further down edits this set rather than making a second.
      let id = setIdRef.current;
      if (id === null) {
        const { set } = await createSet({ ...meta, folder });
        id = set.id;
        setIdRef.current = id;
        savedMeta.current = meta;
      } else if (
        savedMeta.current?.title !== meta.title ||
        savedMeta.current?.description !== meta.description
      ) {
        await updateSet(id, meta);
        savedMeta.current = meta;
      }
      const target = id;

      // 2. Existing cards: the ones removed from the editor, and the ones whose
      //    text or place changed (only the fields that did), one request per
      //    chunk. Ids the server no longer has are skipped, so a retry is safe.
      const kept = new Set(cards.map((card) => card.id));
      const removed = Array.from(savedCards.current.keys()).filter((cardId) => !kept.has(cardId));
      const updates: CardChange[] = cards.flatMap((card) => {
        if (card.id === null) return [];
        const saved = savedCards.current.get(card.id);
        if (!saved) return [];
        const change: CardChange = { id: card.id };
        if (saved.term !== card.term) change.term = card.term;
        if (saved.definition !== card.definition) change.definition = card.definition;
        if (saved.position !== card.position) change.position = card.position;
        return Object.keys(change).length > 1 ? [change] : [];
      });
      for (let start = 0; start < Math.max(removed.length, updates.length); start += CHUNK) {
        const remove = removed.slice(start, start + CHUNK);
        const update = updates.slice(start, start + CHUNK);
        await patchCards(target, { remove, update });
        for (const cardId of remove) savedCards.current.delete(cardId);
        for (const { id: cardId, ...change } of update) {
          const saved = savedCards.current.get(cardId);
          if (saved) savedCards.current.set(cardId, { ...saved, ...change });
        }
      }

      // 3. New cards, through the bulk endpoint. Ids are written back onto the
      //    rows chunk by chunk, so a retry never adds the same card twice.
      const fresh = cards.filter((card) => card.id === null);
      for (let start = 0; start < fresh.length; start += CHUNK) {
        const chunk = fresh.slice(start, start + CHUNK);
        const { cards: created } = await addCards(
          target,
          chunk.map(({ term, definition, position }) => ({ term, definition, position })),
        );
        const idByKey = new Map(chunk.map((card, i) => [card.key, created[i].id]));
        for (const card of created) savedCards.current.set(card.id, card);
        setRows((prev) =>
          prev.map((row) => (idByKey.has(row.key) ? { ...row, id: idByKey.get(row.key)! } : row)),
        );
      }

      setDirty(false);
      router.push(`/flashcards/${target}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the set.'));
      setSaving(false);
    }
  }

  function leave(e: React.MouseEvent) {
    if (!dirty) return;
    e.preventDefault();
    void ask.confirm('Leave without saving your changes?', { danger: true, ok: 'leave' }).then((yes) => {
      if (yes) router.push(backHref);
    });
  }

  return (
    <main>
      <Link href={backHref} className="rt-backlink" onClick={leave}>
        <IconChevronLeft />
        {isNew ? 'All sets' : 'Back to set'}
      </Link>

      <div className="rt-pagehead fc-pagehead">
        <h1>{isNew ? 'new set' : 'edit set'}</h1>
      </div>

      <form onSubmit={save} className="fc-editor" noValidate>
        <div className="fc-panel fc-meta">
          <label className="rt-field">
            <span className="rt-field__label">title</span>
            <input
              className="rt-input fc-input-lg"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
              placeholder="e.g. French — animals"
              maxLength={LIMITS.titleLength}
              autoFocus={isNew && openPanel === null}
            />
          </label>
          <label className="rt-field">
            <span className="rt-field__label">
              description <span className="rt-small">optional</span>
            </span>
            <textarea
              className="rt-input fc-textarea"
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                touch();
              }}
              maxLength={LIMITS.descriptionLength}
            />
          </label>
        </div>

        <div className="fc-cardshead">
          <div className="rt-label fc-cardshead__label">cards · {filledCount}</div>
          {panel === null && (
            <>
              <button type="button" className="rt-btn rt-btn--sm" onClick={() => setPanel('import')}>
                <IconImport />
                Import
              </button>
              <button
                type="button"
                className="rt-btn rt-btn--sm"
                onClick={() => setPanel('generate')}
              >
                <IconGenerate />
                Generate with AI
              </button>
            </>
          )}
        </div>

        {panel === 'import' && (
          <ImportPanel onImport={appendCards} onClose={() => setPanel(null)} />
        )}
        {panel === 'generate' && (
          <GeneratePanel model={aiModel} onAdd={addGenerated} onClose={() => setPanel(null)} />
        )}

        {aiNotice && (
          <div className="rt-note fc-ainotice" role="status">
            <div className="fc-ainotice__head">
              <span className="rt-note__title">
                {plural(aiNotice.count, 'generated card')} added
              </span>
              <button type="button" className="rt-linkbtn" onClick={() => setAiNotice(null)}>
                dismiss
              </button>
            </div>
            Read them over before saving — a model can misread a screenshot.
            <AiReceipt model={aiNotice.model} usage={aiNotice.usage} billedTo={aiNotice.billedTo} />
          </div>
        )}

        <ol className="fc-editrows">
          {rows.map((row, i) => (
            <li key={row.key} className="fc-editrow">
              <div className="fc-editrow__head">
                <span className="fc-editrow__num">{i + 1}</span>
                <span className="fc-editrow__spacer" />
                <button
                  type="button"
                  className="fc-iconbtn"
                  onClick={() => moveRow(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move card ${i + 1} up`}
                  title="Move up"
                >
                  <IconArrowUp />
                </button>
                <button
                  type="button"
                  className="fc-iconbtn"
                  onClick={() => moveRow(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`Move card ${i + 1} down`}
                  title="Move down"
                >
                  <IconArrowDown />
                </button>
                <button
                  type="button"
                  className="fc-iconbtn fc-iconbtn--del"
                  onClick={() => removeRow(row.key)}
                  aria-label={`Delete card ${i + 1}`}
                  title="Delete"
                >
                  <IconTrash />
                </button>
              </div>
              <div className="fc-editrow__fields">
                <label className="rt-field">
                  <span className="fc-editrow__label">term</span>
                  <textarea
                    id={`${row.key}-term`}
                    className="rt-input fc-textarea"
                    rows={1}
                    value={row.term}
                    onChange={(e) => changeRow(row.key, 'term', e.target.value)}
                    maxLength={LIMITS.sideLength}
                  />
                </label>
                <label className="rt-field">
                  <span className="fc-editrow__label">definition</span>
                  <textarea
                    className="rt-input fc-textarea"
                    rows={1}
                    value={row.definition}
                    onChange={(e) => changeRow(row.key, 'definition', e.target.value)}
                    maxLength={LIMITS.sideLength}
                  />
                </label>
              </div>
            </li>
          ))}
        </ol>

        <button type="button" className="fc-addrow" onClick={addRow}>
          <IconPlus />
          Add card
        </button>

        <div className="fc-savebar">
          {error && (
            <div className="rt-note rt-note--err" role="alert">
              {error}
            </div>
          )}
          <div className="rt-btnrow">
            <button type="submit" className="rt-btn rt-btn--primary" disabled={saving}>
              {saving ? 'saving…' : isNew ? 'create set' : 'save changes'}
            </button>
            <Link href={backHref} className="rt-btn" onClick={leave}>
              cancel
            </Link>
            <span className="rt-small">{plural(filledCount, 'card')}</span>
          </div>
        </div>
      </form>
    </main>
  );
}
