import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { PersonSuggestion } from '../shared/types';
import { emailKey, isEmail, parseAddressList } from '../shared/email';
import { matchPeople, mergeSuggestions } from '../shared/meetingForm';
import { api } from './api';
import type { Dict } from '../shared/i18n';
import { Icon } from './icons';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 8;

/**
 * Suggestions for what is being typed: people from the meetings already loaded show at once, the
 * server directory follows after a short pause. An answer to an older query is dropped.
 */
function useSuggestions(query: string, local: readonly PersonSuggestion[], exclude: ReadonlySet<string>) {
  const q = query.trim();
  const [remote, setRemote] = useState<PersonSuggestion[]>([]);
  const [settledFor, setSettledFor] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    if (q.length < MIN_QUERY) {
      latest.current++;
      setRemote([]);
      setSettledFor('');
      return;
    }
    const id = ++latest.current;
    const timer = setTimeout(() => {
      api
        .resolvePeople(q)
        .catch(() => [] as PersonSuggestion[])
        .then((people) => {
          if (id !== latest.current) return;
          setRemote(people);
          setSettledFor(q);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const lower = q.toLowerCase();
  // While the new answer is on its way the old one stays, narrowed to what still matches.
  const remoteNow = useMemo(() => (settledFor === q ? remote : remote.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(lower))), [remote, settledFor, q, lower]);
  const items = useMemo(
    () => (q.length < MIN_QUERY ? [] : mergeSuggestions(matchPeople(local, q, exclude, MAX_SUGGESTIONS), remoteNow, exclude, MAX_SUGGESTIONS)),
    [q, local, remoteNow, exclude],
  );
  return { items, searching: q.length >= MIN_QUERY && settledFor !== q };
}

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

interface Props {
  label: string;
  t: Dict;
  values: string[];
  /** Text typed but not yet turned into a chip. Lives in the form, so "Send" can take it along. */
  draft: string;
  onDraft: (text: string) => void;
  /** Adds addresses; returns a message when it cannot (too many recipients). */
  onAdd: (emails: string[], names?: Record<string, string>) => string | null;
  onRemove: (email: string) => void;
  /** Names the person picked from suggestions, shown as the tooltip of a chip. */
  names: Record<string, string>;
  local: readonly PersonSuggestion[];
  /** Every address already in the form (either list): not suggested again. */
  taken: ReadonlySet<string>;
  disabled?: boolean;
  /** An error the form found with this field (an unfinished address when sending). */
  problem?: string | null;
}

/** Recipients as chips: type an address or a name, pick a suggestion, or paste a whole list. */
export function PeopleField({ label, t, values, draft, onDraft, onAdd, onRemove, names, local, taken, disabled, problem }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  /** The query whose suggestions Escape closed: they come back when the text changes. */
  const [dismissed, setDismissed] = useState('');
  const listId = useId();
  const { items, searching } = useSuggestions(draft, local, taken);
  const query = draft.trim();
  // A complete address with nothing to suggest needs no "no matches" note.
  const open = focused && !disabled && query.length >= MIN_QUERY && dismissed !== query && (items.length > 0 || !isEmail(query));

  useEffect(() => setActive(-1), [items]);

  /**
   * Turns text into chips and returns what stays in the field: the pieces that look like an address
   * but are not one, or the text unchanged when nothing in it can be read as an address.
   */
  function commit(text: string, how: 'enter' | 'quiet'): string {
    const parsed = parseAddressList(text);
    if (parsed.addresses.length) {
      const blocked = onAdd(parsed.addresses);
      if (blocked) {
        setError(blocked);
        return text.trim();
      }
    }
    if (parsed.invalid.length) {
      setError(t.peopleBadAddress(parsed.invalid[0]));
      return parsed.invalid.join(', ');
    }
    if (!parsed.addresses.length) {
      // Words that are not an address are left alone while typing, and reported on Enter.
      if (how === 'enter' && parsed.hadText) setError(t.peopleBadAddress(text.trim().slice(0, 60)));
      return text.trim();
    }
    setError(null);
    return '';
  }

  function pick(p: PersonSuggestion) {
    const blocked = onAdd([p.email], { [emailKey(p.email)]: p.name });
    setError(blocked);
    if (!blocked) onDraft('');
    setActive(-1);
    inputRef.current?.focus();
  }

  function onChange(value: string) {
    setError(null);
    // A comma, a semicolon or a line break ends an address: everything before the last one becomes chips.
    const cut = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'), value.lastIndexOf('\n'), value.lastIndexOf('\r'));
    if (cut >= 0) {
      const left = commit(value.slice(0, cut), 'quiet');
      const rest = value.slice(cut + 1).replace(/^[,;\s]+/, '');
      onDraft([left, rest].filter(Boolean).join(' '));
      return;
    }
    onDraft(value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open || !items.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + items.length) % items.length);
    } else if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) return; // the form sends on Ctrl+Enter
      e.preventDefault();
      if (open && items[active]) pick(items[active]);
      else if (draft.trim()) onDraft(commit(draft, 'enter'));
    } else if (e.key === 'Tab') {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        pick(items[active]);
      } else if (draft.trim()) onDraft(commit(draft, 'quiet'));
    } else if (e.key === 'Escape') {
      // The first Escape closes the suggestions; with none open it reaches the window, which closes.
      if (open) {
        e.preventDefault();
        setDismissed(query);
      }
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onRemove(values[values.length - 1]);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('@') && !/[\s,;]/.test(text.trim())) return; // one plain word: typed as usual
    e.preventDefault();
    onDraft(commit(`${draft} ${text}`, 'enter'));
  }

  const shownError = error ?? problem ?? null;
  return (
    <div className="people">
      <div className={`chips-field${shownError ? ' bad' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
        {values.map((email) => (
          <span key={email} className="chip" title={names[emailKey(email)] ? `${names[emailKey(email)]} <${email}>` : email}>
            <span className="nowrap">{email}</span>
            {!disabled && (
              <button type="button" aria-label={t.peopleRemove(email)} title={t.peopleRemove(email)} onClick={() => onRemove(email)} tabIndex={-1}>
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          maxLength={320}
          placeholder={values.length ? '' : t.peoplePlaceholder}
          aria-label={label}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft.trim()) onDraft(commit(draft, 'quiet'));
          }}
        />
        {open && (
          <div className="suggest" id={listId} role="listbox" aria-label={label}>
            {items.map((p, i) => (
              <button
                type="button"
                key={p.email}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`suggest-item${i === active ? ' active' : ''}`}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="avatar">{initials(p.name)}</span>
                <span className="grow col">
                  <span className="nowrap suggest-name">{p.name}</span>
                  {p.name !== p.email && <span className="nowrap ter suggest-mail">{p.email}</span>}
                </span>
              </button>
            ))}
            {!items.length && (
              <div className="suggest-note ter" role="status">
                {searching ? (
                  <>
                    <span className="spin" /> {t.peopleSearching}
                  </>
                ) : (
                  t.peopleNoMatch
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {shownError && (
        <div className="msg bad people-msg" role="alert">
          {shownError}
        </div>
      )}
    </div>
  );
}
