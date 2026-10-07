import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreateMeetingInput, CreateMeetingPrefill, Recurrence, RecurrenceKind, Snapshot } from '../shared/types';
import { dedupeEmails, emailKey, parseAddressList } from '../shared/email';
import { MAX_MEETING_ATTENDEES, MAX_MEETING_BODY, MAX_OCCURRENCES } from '../shared/validate';
import {
  QUICK_DURATIONS,
  dateText,
  defaultSlot,
  endsNextDay,
  localPeople,
  slotFromPrefill,
  slotMinutes,
  slotRange,
  withDuration,
  withEnd,
  withStart,
  type Slot,
} from '../shared/meetingForm';
import { api } from './api';
import { duration } from './format';
import { ipcMessage, useI18n } from './hooks';
import { Icon } from './icons';
import { Alert } from './Alert';
import { PeopleField } from './PeopleField';

// Exchange keeps a subject and a location to 255 characters; the form stops there.
// (The main process accepts up to 500 and refuses more, it never shortens anything silently.)
const FIELD_MAX = 255;
const DONE_CLOSE_MS = 1800;

interface Form {
  title: string;
  slot: Slot;
  required: string[];
  optional: string[];
  draftRequired: string;
  draftOptional: string;
  location: string;
  body: string;
  repeat: RecurrenceKind;
  /** How the series ends; only read when `repeat` is not "none". */
  endKind: 'count' | 'until';
  count: number;
  until: string;
  /** Set when the form is changing a meeting that exists, instead of creating one. */
  editId?: string;
  editRecurring?: boolean;
}

function emptyForm(now = new Date()): Form {
  const slot = defaultSlot(now);
  return {
    title: '',
    slot,
    required: [],
    optional: [],
    draftRequired: '',
    draftOptional: '',
    location: '',
    body: '',
    repeat: 'none',
    endKind: 'count',
    count: 10,
    until: dateText(new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())),
  };
}

function formFromPrefill(p: CreateMeetingPrefill, now = new Date()): Form {
  return {
    ...emptyForm(now),
    title: p.title ?? '',
    slot: slotFromPrefill(p, now),
    required: dedupeEmails(p.attendees ?? []),
    optional: dedupeEmails(p.optional ?? []),
    location: p.location ?? '',
    body: p.body ?? '',
    editId: p.editId,
    editRecurring: p.editRecurring,
  };
}

const REPEATS: readonly RecurrenceKind[] = ['none', 'daily', 'weekdays', 'weekly', 'biweekly'];

/** What the form sends as the recurrence; an existing meeting is never turned into a series here. */
function recurrenceOf(f: Form): Recurrence {
  if (f.editId || f.repeat === 'none') return { kind: 'none' };
  return { kind: f.repeat, end: f.endKind === 'count' ? { kind: 'count', count: f.count } : { kind: 'until', date: f.until } };
}

type Phase = 'edit' | 'sending' | 'done';

export function Create({ snap }: { snap: Snapshot }) {
  const { t } = useI18n(snap);
  const [form, setForm] = useState<Form>(() => emptyForm());
  const [phase, setPhase] = useState<Phase>('edit');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [invited, setInvited] = useState(0);
  /** Which operation the "done" screen is reporting: creating a meeting or changing one. */
  const [done, setDone] = useState<'created' | 'updated'>('created');
  const [titleTouched, setTitleTouched] = useState(false);
  const [problems, setProblems] = useState<{ required?: string; optional?: string }>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const sending = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = t.createMeeting;
  }, [t]);

  // The window starts from what it was opened with, and starts over if it is asked to while open.
  useEffect(() => {
    let alive = true;
    const apply = (p: CreateMeetingPrefill) => {
      setForm(formFromPrefill(p));
      setPhase('edit');
      setError(null);
      setNote(null);
      setProblems({});
      setTitleTouched(false);
      sending.current = false;
    };
    void api.getCreatePrefill().then((p) => alive && p && apply(p));
    const off = api.onCreatePrefill(apply);
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => titleRef.current?.focus(), []);

  const local = useMemo(() => localPeople(snap.events), [snap.events]);
  const taken = useMemo(() => new Set([...form.required, ...form.optional].map(emailKey)), [form.required, form.optional]);
  const total = form.required.length + form.optional.length;

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const patchSlot = (next: Slot) => setForm((f) => ({ ...f, slot: next }));

  /** Adds addresses to one list; one that is already in the other list moves. Returns a message when the limit is hit. */
  function addPeople(kind: 'required' | 'optional', emails: string[], picked?: Record<string, string>): string | null {
    const other = kind === 'required' ? 'optional' : 'required';
    const keys = new Set(emails.map(emailKey));
    const after = dedupeEmails([...form[kind], ...emails]).length + form[other].filter((e) => !keys.has(emailKey(e))).length;
    if (after > MAX_MEETING_ATTENDEES) return t.peopleTooMany(MAX_MEETING_ATTENDEES);
    setForm((f) => ({ ...f, [kind]: dedupeEmails([...f[kind], ...emails]), [other]: f[other].filter((e) => !keys.has(emailKey(e))) }));
    if (picked) setNames((n) => ({ ...n, ...picked }));
    setProblems({});
    return null;
  }

  const removePerson = (kind: 'required' | 'optional', email: string) => setForm((f) => ({ ...f, [kind]: f[kind].filter((e) => e !== email) }));

  const range = slotRange(form.slot);
  const minutes = slotMinutes(form.slot);
  const titleMissing = !form.title.trim();

  /** What would be sent, or why not. Text left in the recipient fields is taken along when it is an address. */
  function build(): { input?: CreateMeetingInput; error?: string; problems?: typeof problems } {
    if (titleMissing) return { error: t.titleRequired };
    if (!range) return { error: t.timeInvalid };
    const lists = { required: form.required, optional: form.optional };
    const bad: typeof problems = {};
    for (const kind of ['required', 'optional'] as const) {
      const draft = kind === 'required' ? form.draftRequired : form.draftOptional;
      const parsed = parseAddressList(draft);
      if (parsed.invalid.length || (!parsed.addresses.length && parsed.hadText)) bad[kind] = t.peopleBadAddress(parsed.invalid[0] ?? draft.trim().slice(0, 60));
      lists[kind] = dedupeEmails([...lists[kind], ...parsed.addresses]);
    }
    if (bad.required || bad.optional) return { error: bad.required ?? bad.optional, problems: bad };
    const required = lists.required;
    const optional = lists.optional.filter((e) => !required.some((r) => emailKey(r) === emailKey(e)));
    if (required.length + optional.length > MAX_MEETING_ATTENDEES) return { error: t.peopleTooMany(MAX_MEETING_ATTENDEES) };
    return {
      input: {
        title: form.title.trim(),
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        requiredAttendees: required,
        optionalAttendees: optional,
        location: form.location.trim(),
        body: form.body,
        recurrence: recurrenceOf(form),
      },
    };
  }

  const submit = useCallback(async () => {
    if (sending.current || phase !== 'edit') return; // a double click sends once
    setError(null);
    setNote(null);
    setTitleTouched(true);
    const built = build();
    if (!built.input) {
      setError(built.error ?? null);
      setProblems(built.problems ?? {});
      if (titleMissing) titleRef.current?.focus();
      return;
    }
    setProblems({});
    sending.current = true;
    setPhase('sending');
    try {
      const res = form.editId ? await api.editMeeting({ ...built.input, id: form.editId }) : await api.createMeeting(built.input);
      if (res.status === 'cancelled') {
        setPhase('edit');
        setNote(t.createCancelledNote);
        return;
      }
      setInvited(res.invited);
      setDone(res.status === 'updated' ? 'updated' : 'created');
      setPhase('done');
      setTimeout(() => void api.closeWindow(), DONE_CLOSE_MS);
    } catch (e) {
      setPhase('edit');
      setError(ipcMessage(e));
    } finally {
      sending.current = false;
    }
  }, [form, phase, t]);

  // Esc closes (a suggestion list that is open takes the first Esc); Ctrl+Enter sends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && phase !== 'sending') void api.closeWindow();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, submit]);

  if (phase === 'done') {
    return (
      <div className="create">
        <div className="create-done" role="status">
          <span className="done-icon">
            <Icon name="check" size={30} weight={2.2} />
          </span>
          <h1>{done === 'updated' ? t.editDone : t.createdTitle}</h1>
          <p className="sec">{done === 'updated' ? (invited > 0 ? t.editDoneInvited(invited) : t.editDone) : invited > 0 ? t.createdInvited(invited) : t.createdSaved}</p>
          <button className="btn" onClick={() => void api.closeWindow()}>
            {t.close}
          </button>
        </div>
      </div>
    );
  }

  const locked = phase === 'sending';
  const withInvitations = total > 0 || !!parseAddressList(form.draftRequired + ' ' + form.draftOptional).addresses.length;
  const lengthText = minutes === null ? null : t.lengthIs(duration(minutes, t));

  return (
    <div className="create">
      <form
        className="create-scroll"
        // Enter in a field never sends (Ctrl+Enter and the button do): a stray Enter must not save a meeting.
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <fieldset disabled={locked} className="create-fields">
          <h1>{form.editId ? t.editTitle : t.createMeeting}</h1>

          <div className="form-row">
            <label htmlFor="cm-title">{t.fieldTitle}</label>
            <input
              id="cm-title"
              ref={titleRef}
              className={`field wide${titleTouched && titleMissing ? ' bad' : ''}`}
              value={form.title}
              maxLength={FIELD_MAX}
              placeholder={t.titlePlaceholder}
              autoComplete="off"
              aria-invalid={titleTouched && titleMissing}
              onChange={(e) => patch({ title: e.target.value })}
              onBlur={() => setTitleTouched(true)}
            />
          </div>

          <div className="form-row">
            <span className="form-label">{t.fieldWhen}</span>
            <div className="when">
              <div className="when-inputs">
                <input
                  type="date"
                  className="field date"
                  aria-label={t.fieldDate}
                  value={form.slot.date}
                  min={dateText(new Date())}
                  onChange={(e) => e.target.value && patchSlot({ ...form.slot, date: e.target.value })}
                />
                <input type="time" className="field time" aria-label={t.timeStart} value={form.slot.start} onChange={(e) => patchSlot(withStart(form.slot, e.target.value))} />
                <span className="sec" aria-hidden="true">
                  –
                </span>
                <input type="time" className="field time" aria-label={t.timeEnd} value={form.slot.end} onChange={(e) => patchSlot(withEnd(form.slot, e.target.value))} />
              </div>
              <div className="when-extra">
                <div className="quick">
                  {QUICK_DURATIONS.map((m) => (
                    <button type="button" key={m} className={`btn compact${minutes === m ? ' on' : ''}`} title={t.quickDurationTitle(m)} onClick={() => patchSlot(withDuration(form.slot, m))}>
                      {t.quickDuration(m)}
                    </button>
                  ))}
                </div>
                <span className={`msg${range ? ' sec' : ' bad'}`} role={range ? undefined : 'alert'}>
                  {range ? `${lengthText}${endsNextDay(form.slot) ? ` · ${t.endsNextDay}` : ''}` : t.timeInvalid}
                </span>
              </div>
            </div>
          </div>

          {/* A series is only offered for a new meeting: changing one occurrence of an existing series
              is a different request, and offering it here would promise something the window cannot do. */}
          {!form.editId && (
            <div className="form-row">
              <span className="form-label">{t.fieldRepeat}</span>
              <div className="repeat">
                <select className="field" aria-label={t.fieldRepeat} value={form.repeat} onChange={(e) => patch({ repeat: e.target.value as RecurrenceKind })}>
                  {REPEATS.map((r) => (
                    <option key={r} value={r}>
                      {t.repeatName(r, new Date(`${form.slot.date}T12:00:00`))}
                    </option>
                  ))}
                </select>
                {form.repeat !== 'none' && (
                  <div className="repeat-end">
                    <select className="field" aria-label={t.repeatEnds} value={form.endKind} onChange={(e) => patch({ endKind: e.target.value as 'count' | 'until' })}>
                      <option value="count">{t.repeatTimes}</option>
                      <option value="until">{t.repeatUntil}</option>
                    </select>
                    {form.endKind === 'count' ? (
                      <input
                        type="number"
                        className="field repeat-count"
                        min={1}
                        max={MAX_OCCURRENCES}
                        aria-label={t.repeatTimes}
                        value={form.count}
                        onChange={(e) => patch({ count: Math.min(MAX_OCCURRENCES, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                      />
                    ) : (
                      <input type="date" className="field date" aria-label={t.repeatUntil} min={form.slot.date} value={form.until} onChange={(e) => e.target.value && patch({ until: e.target.value })} />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {form.editId && form.editRecurring && <div className="form-row tight"><span className="form-label" /><span className="hint">{t.editSeriesHint}</span></div>}

          <div className="form-row">
            <span className="form-label">{t.fieldRequiredPeople}</span>
            <PeopleField
              label={t.fieldRequiredPeople}
              t={t}
              values={form.required}
              draft={form.draftRequired}
              onDraft={(draftRequired) => setForm((f) => ({ ...f, draftRequired }))}
              onAdd={(emails, picked) => addPeople('required', emails, picked)}
              onRemove={(e) => removePerson('required', e)}
              names={names}
              local={local}
              taken={taken}
              disabled={locked}
              problem={problems.required}
            />
          </div>

          <div className="form-row">
            <span className="form-label">{t.fieldOptionalPeople}</span>
            <PeopleField
              label={t.fieldOptionalPeople}
              t={t}
              values={form.optional}
              draft={form.draftOptional}
              onDraft={(draftOptional) => setForm((f) => ({ ...f, draftOptional }))}
              onAdd={(emails, picked) => addPeople('optional', emails, picked)}
              onRemove={(e) => removePerson('optional', e)}
              names={names}
              local={local}
              taken={taken}
              disabled={locked}
              problem={problems.optional}
            />
          </div>
          <div className="form-row tight">
            <span />
            <span className="hint">{t.peopleHint}</span>
          </div>

          <div className="form-row">
            <label htmlFor="cm-location">{t.fieldLocation}</label>
            <input id="cm-location" className="field wide" value={form.location} maxLength={FIELD_MAX} placeholder={t.locationPlaceholder} autoComplete="off" onChange={(e) => patch({ location: e.target.value })} />
          </div>

          <div className="form-row">
            <label htmlFor="cm-body">{t.fieldBody}</label>
            <textarea id="cm-body" className="field wide body" rows={6} value={form.body} maxLength={MAX_MEETING_BODY} placeholder={t.bodyPlaceholder} onChange={(e) => patch({ body: e.target.value })} />
          </div>
        </fieldset>
      </form>

      <div className="create-foot">
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={locked} onClick={() => void submit()}>
            {locked ? <span className="spin on-accent" /> : null}
            {locked ? t.sendingMeeting : form.editId ? (withInvitations ? t.editSend : t.editSave) : withInvitations ? t.sendInvitations : t.saveMeeting}
          </button>
          <button className="btn" disabled={locked} onClick={() => void api.closeWindow()}>
            {t.cancel}
          </button>
        </div>
        <div className="foot-msg">
          {error && <Alert title={error} />}
          {!error && note && (
            <div className="msg sec" role="status">
              {note}
            </div>
          )}
          {!error && !note && withInvitations && <div className="hint">{t.confirmNote}</div>}
        </div>
      </div>
    </div>
  );
}
