/**
 * How a worker's day is split across the tasks they're on.
 *
 * A supervisor assigns people to tasks; he shouldn't also have to do the
 * arithmetic of dividing a nine-hour day three ways. So every cell he hasn't
 * typed into gets an equal share of whatever is left of that worker's day
 * after the cells he HAS typed into are taken off. The day total lands on
 * `dayHours` by itself, and a worker on a single task gets the whole day.
 *
 * Used by Goals (planned hours) and the DPR (hours actually worked).
 */

export const DEFAULT_DAY_HOURS = 9;

const round2 = (n) => Math.round(n * 100) / 100;

/** The key an allocation is stored under. */
export const cellKey = (taskKey, employeeId) => `${taskKey}|${employeeId}`;

/**
 * @param {Array<{taskKey: string, employeeId: string, hours: number|null}>} cells
 *   One per assignment. `hours` set means the user typed it, so it is kept as
 *   given; null means "work it out for me".
 * @param {number} dayHours The standard working day.
 * @returns {Record<string, number>} cellKey → hours.
 */
export function allocateHours(cells, dayHours = DEFAULT_DAY_HOURS) {
  const byWorker = new Map();
  cells.forEach((c) => {
    if (!byWorker.has(c.employeeId)) byWorker.set(c.employeeId, []);
    byWorker.get(c.employeeId).push(c);
  });

  const out = {};
  byWorker.forEach((rows) => {
    const typed = rows.filter((r) => Number.isFinite(r.hours));
    const auto = rows.filter((r) => !Number.isFinite(r.hours));
    const used = typed.reduce((sum, r) => sum + r.hours, 0);
    const share = auto.length ? Math.max(dayHours - used, 0) / auto.length : 0;
    typed.forEach((r) => { out[cellKey(r.taskKey, r.employeeId)] = round2(r.hours); });
    auto.forEach((r) => { out[cellKey(r.taskKey, r.employeeId)] = round2(share); });
  });
  return out;
}

/**
 * The hours every assignment on a task list should save with.
 * `crew` is `{ employeeId: { hours: string, worked: boolean } }` — an empty
 * hours string is an untouched cell and gets its share.
 */
export function resolveTaskHours(tasks, dayHours = DEFAULT_DAY_HOURS) {
  const cells = [];
  tasks.forEach((t) => {
    Object.entries(t.crew ?? {}).forEach(([employeeId, c]) => {
      const typed = Number(c?.hours);
      cells.push({
        taskKey: t.key,
        employeeId,
        hours: c?.hours === '' || c?.hours === undefined || !Number.isFinite(typed) ? null : typed,
      });
    });
  });
  return allocateHours(cells, dayHours);
}

/** Total hours per worker across the whole day: employeeId → hours. */
export function dayTotals(allocation) {
  const totals = {};
  Object.entries(allocation).forEach(([key, hours]) => {
    const employeeId = key.slice(key.indexOf('|') + 1);
    totals[employeeId] = round2((totals[employeeId] ?? 0) + hours);
  });
  return totals;
}
