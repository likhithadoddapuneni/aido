import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advance,
  currentCursor,
  goBack,
  hasPrevious,
  initialStack,
  pageNumber,
  reset,
  type CursorStack,
} from '../src/index.ts';

describe('cursor stack (keyset pagination)', () => {
  it('starts on page one with no cursor', () => {
    const s = initialStack();
    expect([currentCursor(s), pageNumber(s), hasPrevious(s)]).toEqual([null, 1, false]);
  });

  it('forward then back returns to the exact cursor each page was fetched with', () => {
    let s = initialStack();
    s = advance(s, 'c2');
    s = advance(s, 'c3');
    expect(currentCursor(s)).toBe('c3');
    expect(pageNumber(s)).toBe(3);
    s = goBack(s);
    expect(currentCursor(s)).toBe('c2');
    s = goBack(s);
    expect(currentCursor(s)).toBeNull();
    expect(goBack(s)).toBe(s); // cannot go before the first page
  });

  it('never mutates a previous state', () => {
    const a = advance(initialStack(), 'c2');
    const b = advance(a, 'c3');
    expect(a.stack).toEqual([null, 'c2']);
    expect(b.stack).toEqual([null, 'c2', 'c3']);
  });

  type Op = { op: 'next'; cursor: string } | { op: 'back' } | { op: 'reset' };
  const ops = fc.array(
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 8 }).map((cursor): Op => ({ op: 'next', cursor })),
      fc.constant<Op>({ op: 'back' }),
      fc.constant<Op>({ op: 'reset' }),
    ),
    { maxLength: 60 },
  );

  it('PROPERTY: against a model, any sequence keeps page ≥ 1, the first page cursorless, and back undoes next', () => {
    fc.assert(
      fc.property(ops, (sequence) => {
        let s: CursorStack = initialStack();
        const model: (string | null)[] = [null];
        for (const o of sequence) {
          if (o.op === 'next') {
            s = advance(s, o.cursor);
            model.push(o.cursor);
          } else if (o.op === 'back') {
            s = goBack(s);
            if (model.length > 1) model.pop();
          } else {
            s = reset();
            model.length = 1;
          }
          expect(pageNumber(s)).toBe(model.length);
          expect(currentCursor(s)).toBe(model[model.length - 1]);
          expect(s.stack[0]).toBeNull();
          expect(hasPrevious(s)).toBe(model.length > 1);
        }
      }),
    );
  });

  it('PROPERTY: n nexts followed by n backs is the identity', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { maxLength: 30 }), (cursors) => {
        const start = initialStack();
        let s = start;
        for (const c of cursors) s = advance(s, c);
        for (let i = 0; i < cursors.length; i++) s = goBack(s);
        expect(s.stack).toEqual(start.stack);
      }),
    );
  });
});
