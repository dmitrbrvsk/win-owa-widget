import { describe, expect, it } from 'vitest';
import { MAX_NOTE } from '../src/shared/limits';
import { MAX_NOTES, NOTE_KEEP_MS, NoteBook } from '../src/shared/notes';

const NOW = new Date('2026-10-12T10:00:00Z');
const START = '2026-10-13T08:00:00.000Z';
const DAY = 86_400_000;

describe('NoteBook', () => {
  it('keeps a note for a meeting and gives it back, and removes it when it is emptied', () => {
    const b = new NoteBook();
    expect(b.get('a')).toBe('');
    expect(b.set('a', 'Обсудить бюджет\n— риски', START, NOW)).toBe('saved');
    expect(b.get('a')).toBe('Обсудить бюджет\n— риски');
    expect(b.ids()).toEqual(['a']);
    expect(b.set('a', '  \n ', START, NOW)).toBe('removed');
    expect(b.get('a')).toBe('');
    expect(b.size).toBe(0);
  });

  it('cleans hidden characters, keeps line breaks, and refuses what is too long', () => {
    const b = new NoteBook();
    b.set('a', 'x‮y\u0007z\r\nw', START, NOW);
    expect(b.get('a')).toBe('xyz\nw');
    expect(() => b.set('a', 'x'.repeat(MAX_NOTE + 1), START, NOW)).toThrow(/длиннее/);
    expect(() => b.set('a', 'x'.repeat(MAX_NOTE * 5), START, NOW)).toThrow(/слишком длинная/);
    expect(() => b.set('a', 42 as unknown as string, START, NOW)).toThrow();
    expect(() => b.set('', 'x', START, NOW)).toThrow();
    expect(() => b.set('i'.repeat(3000), 'x', START, NOW)).toThrow();
    b.set('b', 'x'.repeat(MAX_NOTE), START, NOW);
    expect(b.get('b')).toHaveLength(MAX_NOTE);
  });

  it('refuses a new note past the cap, but lets an existing one be changed', () => {
    const b = new NoteBook();
    for (let i = 0; i < MAX_NOTES; i++) b.set(`n${i}`, 'x', START, NOW);
    expect(() => b.set('one-more', 'x', START, NOW)).toThrow(/Слишком много заметок/);
    expect(b.set('n0', 'changed', START, NOW)).toBe('saved');
    expect(b.set('n1', '', START, NOW)).toBe('removed');
    expect(b.set('one-more', 'x', START, NOW)).toBe('saved');
  });

  it('forgets the notes of meetings older than three months, and only those', () => {
    const b = new NoteBook();
    b.set('old', 'x', new Date(NOW.getTime() - NOTE_KEEP_MS - DAY).toISOString(), NOW);
    b.set('recent', 'y', new Date(NOW.getTime() - 30 * DAY).toISOString(), NOW);
    b.set('future', 'z', START, NOW);
    expect(b.prune(NOW)).toBe(1);
    expect(b.ids().sort()).toEqual(['future', 'recent']);
  });

  it('counts how many it cleared', () => {
    const b = new NoteBook();
    b.set('a', 'x', START, NOW);
    b.set('b', 'y', START, NOW);
    expect(b.clear()).toBe(2);
    expect(b.clear()).toBe(0);
  });

  it('survives a round trip through JSON', () => {
    const b = new NoteBook();
    b.set('a', 'заметка', START, NOW);
    const again = NoteBook.parse(JSON.parse(JSON.stringify(b)), NOW);
    expect(again.get('a')).toBe('заметка');
    expect(again.toJSON()).toEqual(b.toJSON());
  });

  it('reads a tampered file strictly: bad entries are dropped, the rest is kept', () => {
    const good = { id: 'ok', text: 'fine', start: START, at: NOW.toISOString() };
    const book = NoteBook.parse(
      {
        version: 1,
        notes: [
          good,
          null,
          'x',
          { ...good, id: '' },
          { ...good, id: 7 },
          { ...good, id: 'no-text', text: 42 },
          { ...good, id: 'empty', text: '  ' },
          { ...good, id: 'bad-start', start: 'yesterday' },
          { ...good, id: 'bad-at', at: '2026-13-45T00:00:00Z' },
          { ...good, id: 'ancient', start: '2020-01-01T00:00:00Z' },
          { ...good, id: 'hidden', text: 'a‮b' },
          { ...good, id: 'long', text: 'x'.repeat(MAX_NOTE * 3) },
        ],
      },
      NOW,
    );
    expect(book.ids().sort()).toEqual(['hidden', 'long', 'ok']);
    expect(book.get('hidden')).toBe('ab');
    expect(book.get('long')).toHaveLength(MAX_NOTE); // cut to the limit, not refused: it is still the person's note
    for (const junk of [null, undefined, 42, 'x', [], {}, { notes: 'x' }, { notes: {} }]) expect(NoteBook.parse(junk, NOW).size).toBe(0);
  });

  it('never reads more than the cap from a file, whatever it holds', () => {
    const many = Array.from({ length: MAX_NOTES * 3 }, (_, i) => ({ id: `n${i}`, text: 'x', start: START, at: NOW.toISOString() }));
    expect(NoteBook.parse({ notes: many }, NOW).size).toBe(MAX_NOTES);
  });
});
