import { describe, expect, it } from 'vitest';
import { allocateHours, cellKey, dayTotals, resolveTaskHours } from './taskHours';

const cell = (taskKey, employeeId, hours = null) => ({ taskKey, employeeId, hours });

describe('allocateHours', () => {
  it('gives a worker on one task the whole day', () => {
    expect(allocateHours([cell('t1', 'e1')], 9)).toEqual({ 't1|e1': 9 });
  });

  it('splits the day evenly across the tasks a worker is on', () => {
    const out = allocateHours([cell('t1', 'e1'), cell('t2', 'e1'), cell('t3', 'e1')], 9);
    expect(out).toEqual({ 't1|e1': 3, 't2|e1': 3, 't3|e1': 3 });
  });

  it('halves an odd day rather than rounding it away', () => {
    expect(allocateHours([cell('t1', 'e1'), cell('t2', 'e1')], 9)).toEqual({ 't1|e1': 4.5, 't2|e1': 4.5 });
  });

  it('splits each worker over their own tasks, not everyone over all of them', () => {
    const out = allocateHours([
      cell('t1', 'e1'), cell('t2', 'e1'),
      cell('t1', 'e2'),
    ], 9);
    expect(out).toEqual({ 't1|e1': 4.5, 't2|e1': 4.5, 't1|e2': 9 });
  });

  it('keeps a typed value and re-splits the rest of that day', () => {
    const out = allocateHours([cell('t1', 'e1', 5), cell('t2', 'e1'), cell('t3', 'e1')], 9);
    expect(out).toEqual({ 't1|e1': 5, 't2|e1': 2, 't3|e1': 2 });
  });

  it('never allocates negative hours when the typed values overrun the day', () => {
    const out = allocateHours([cell('t1', 'e1', 10), cell('t2', 'e1')], 9);
    expect(out).toEqual({ 't1|e1': 10, 't2|e1': 0 });
  });

  it('leaves an all-typed day exactly as typed, over or under the standard day', () => {
    const out = allocateHours([cell('t1', 'e1', 6), cell('t2', 'e1', 6)], 9);
    expect(out).toEqual({ 't1|e1': 6, 't2|e1': 6 });
    expect(dayTotals(out)).toEqual({ e1: 12 });
  });

  it('honours a non-standard day length', () => {
    expect(allocateHours([cell('t1', 'e1'), cell('t2', 'e1')], 8)).toEqual({ 't1|e1': 4, 't2|e1': 4 });
  });

  it('rounds a share that does not divide cleanly to two decimals', () => {
    const out = allocateHours([cell('t1', 'e1'), cell('t2', 'e1'), cell('t3', 'e1')], 10);
    expect(out).toEqual({ 't1|e1': 3.33, 't2|e1': 3.33, 't3|e1': 3.33 });
  });
});

describe('dayTotals', () => {
  it('adds a worker up across tasks and keeps workers apart', () => {
    const out = allocateHours([cell('t1', 'e1'), cell('t2', 'e1'), cell('t1', 'e2', 4)], 9);
    expect(dayTotals(out)).toEqual({ e1: 9, e2: 4 });
  });

  it('is empty when nobody is assigned', () => {
    expect(dayTotals(allocateHours([], 9))).toEqual({});
  });
});

describe('resolveTaskHours', () => {
  const tasks = [
    { key: 't1', crew: { e1: { hours: '', worked: true }, e2: { hours: '6', worked: true } } },
    { key: 't2', crew: { e1: { hours: '', worked: true } } },
  ];

  it('treats a blank hours box as automatic and a filled one as typed', () => {
    expect(resolveTaskHours(tasks, 9)).toEqual({ 't1|e1': 4.5, 't2|e1': 4.5, 't1|e2': 6 });
  });

  it('ignores junk in the hours box instead of producing NaN', () => {
    const out = resolveTaskHours([{ key: 't1', crew: { e1: { hours: 'abc' } } }], 9);
    expect(out).toEqual({ 't1|e1': 9 });
  });

  it('copes with a task that has no crew at all', () => {
    expect(resolveTaskHours([{ key: 't1' }], 9)).toEqual({});
  });

  it('keys cells the way cellKey does', () => {
    const out = resolveTaskHours(tasks, 9);
    expect(out[cellKey('t1', 'e2')]).toBe(6);
  });
});
