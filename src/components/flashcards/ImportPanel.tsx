
import { useId, useMemo, useState } from 'react';

import {
  DEFAULT_IMPORT_OPTIONS,
  parseImport,
  type CardSeparator,
  type ImportOptions,
  type TermSeparator,
} from '@/lib/flashcards/import';
import { plural } from '@/lib/flashcards/format';

const TERM_SEPARATORS: { value: TermSeparator; label: string; example: string }[] = [
  { value: 'dash', label: 'dash', example: 'chien - dog' },
  { value: 'comma', label: 'comma', example: 'chien, dog' },
  { value: 'tab', label: 'tab', example: 'chien\tdog' },
  { value: 'custom', label: 'custom', example: 'chien = dog' },
];

const CARD_SEPARATORS: { value: CardSeparator; label: string }[] = [
  { value: 'newline', label: 'new line' },
  { value: 'semicolon', label: 'semicolon' },
  { value: 'custom', label: 'custom' },
];

const PREVIEW_ROWS = 5;

/**
 * Paste box → rows. Parsing happens as you type, so the count and the preview
 * are the check that the separator is the right one before anything moves.
 */
export function ImportPanel({
  onImport,
  onClose,
}: {
  onImport: (cards: { term: string; definition: string }[]) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const [text, setText] = useState('');
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);

  const parsed = useMemo(() => parseImport(text, options), [text, options]);
  const found = parsed.cards.length;
  const example =
    TERM_SEPARATORS.find((s) => s.value === options.between)?.example ?? 'chien - dog';
  const cardJoiner = options.cards === 'semicolon' ? '; ' : '\n';

  function patch(next: Partial<ImportOptions>) {
    setOptions((prev) => ({ ...prev, ...next }));
  }

  return (
    <section className="fc-panel fc-import" aria-labelledby={`${uid}-title`}>
      <div className="fc-panel__head">
        <h2 id={`${uid}-title`} className="fc-panel__title">
          import
        </h2>
        <button type="button" className="rt-linkbtn" onClick={onClose}>
          close
        </button>
      </div>

      <label className="rt-field">
        <span className="rt-field__label">
          Paste your cards — from a spreadsheet, a document, or another app&apos;s export.
        </span>
        <textarea
          className="rt-input fc-import__text"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={[example, example.replace('chien', 'chat').replace('dog', 'cat')].join(
            cardJoiner,
          )}
          spellCheck={false}
          autoFocus
        />
      </label>

      <div className="fc-import__opts">
        <fieldset className="fc-fieldset">
          <legend className="rt-field__label">between term and definition</legend>
          <div className="fc-radios">
            {TERM_SEPARATORS.map((sep) => (
              <label key={sep.value} className="fc-radio">
                <input
                  type="radio"
                  name={`${uid}-between`}
                  checked={options.between === sep.value}
                  onChange={() => patch({ between: sep.value })}
                />
                {sep.label}
              </label>
            ))}
          </div>
          {options.between === 'custom' && (
            <input
              className="rt-input fc-import__custom"
              value={options.betweenCustom}
              onChange={(e) => patch({ betweenCustom: e.target.value })}
              placeholder="e.g. =  or  :"
              aria-label="Custom separator between term and definition"
            />
          )}
        </fieldset>

        <fieldset className="fc-fieldset">
          <legend className="rt-field__label">between cards</legend>
          <div className="fc-radios">
            {CARD_SEPARATORS.map((sep) => (
              <label key={sep.value} className="fc-radio">
                <input
                  type="radio"
                  name={`${uid}-cards`}
                  checked={options.cards === sep.value}
                  onChange={() => patch({ cards: sep.value })}
                />
                {sep.label}
              </label>
            ))}
          </div>
          {options.cards === 'custom' && (
            <input
              className="rt-input fc-import__custom"
              value={options.cardsCustom}
              onChange={(e) => patch({ cardsCustom: e.target.value })}
              placeholder="e.g. |  or  \n\n"
              aria-label="Custom separator between cards"
            />
          )}
        </fieldset>
      </div>

      {text.trim() !== '' && (
        <div className="fc-import__preview" aria-live="polite">
          <div className="rt-small">
            {plural(found, 'card')} found
            {parsed.skipped.length > 0 &&
              ` · ${parsed.skipped.length} skipped (no separator, or one side empty)`}
          </div>
          {found > 0 && (
            <ol className="fc-terms fc-terms--compact">
              {parsed.cards.slice(0, PREVIEW_ROWS).map((card, i) => (
                <li key={i} className="fc-term">
                  <div className="fc-term__term">{card.term}</div>
                  <div className="fc-term__def">{card.definition}</div>
                </li>
              ))}
            </ol>
          )}
          {found > PREVIEW_ROWS && (
            <div className="rt-small">…and {plural(found - PREVIEW_ROWS, 'more card')}</div>
          )}
          {parsed.skipped.length > 0 && (
            <div className="rt-small fc-import__skipped">
              skipped: {parsed.skipped.slice(0, 3).map((s) => `“${s}”`).join(', ')}
              {parsed.skipped.length > 3 && ', …'}
            </div>
          )}
        </div>
      )}

      <div className="rt-btnrow">
        <button
          type="button"
          className="rt-btn rt-btn--primary"
          disabled={found === 0}
          onClick={() => onImport(parsed.cards)}
        >
          {found === 0 ? 'add cards' : `add ${plural(found, 'card')}`}
        </button>
        <button type="button" className="rt-btn" onClick={onClose}>
          cancel
        </button>
      </div>
    </section>
  );
}
