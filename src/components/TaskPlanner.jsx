import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Search, Trash2, Users2, X } from 'lucide-react';
import { THEME } from '../lib/theme';
import { UNITS } from '../config/fields';
import { DELAY_REASONS, DPR_TASKS, TASK_STATUS, specFor } from '../config/dprTasks';
import { cellKey, dayTotals, resolveTaskHours } from '../lib/taskHours';
import { Btn, Field, IconBtn, Input, Modal, Select } from './ui';

/**
 * The task editor shared by Goals (the morning plan) and the DPR (the evening
 * report), in `mode="plan"` and `mode="report"`.
 *
 * It replaces the old form, which put six fields and a checkbox for every
 * worker on screen for every task at once. Three ideas keep it calm:
 *
 *  - **One line per task.** The three things that change daily — quantity,
 *    crew and (reporting) whether it got done — sit on the card itself.
 *    Specification, location and remarks hide behind a chevron.
 *  - **Crew as chips.** Workers are picked from a searchable list and shown as
 *    chips, so a site with twenty on the roll costs no more screen than one
 *    with three.
 *  - **Hours work themselves out.** Each worker's standard day is divided over
 *    the tasks they're on (`src/lib/taskHours.js`); typing in one box re-splits
 *    the rest. The day strip at the foot shows every worker's total.
 */

export const blankTask = (over = {}) => ({
  key: `t${Math.random().toString(36).slice(2)}`,
  id: null,
  description: '',
  size_spec: '',
  area: '',
  qty: '',
  unit: '',
  remarks: '',
  goal_task_id: null,
  planned_qty: null,
  status: '',
  status_note: '',
  delay_reason: '',
  crew: {},
  open: true,
  ...over,
});

/** A task row read back from `goal_tasks` or `dpr_tasks` into form shape. */
export const taskFromRow = (row, crewRows, over = {}) => blankTask({
  key: row.id,
  id: row.id,
  description: row.description ?? '',
  size_spec: row.size_spec ?? '',
  area: row.area ?? '',
  qty: row.qty === null || row.qty === undefined ? '' : String(row.qty),
  unit: row.unit ?? '',
  remarks: row.remarks ?? '',
  open: false,
  crew: Object.fromEntries((crewRows ?? []).map((m) => [m.employee_id, {
    hours: m.hours === null || m.hours === undefined ? '' : String(m.hours),
    worked: m.worked !== false,
  }])),
  ...over,
});

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export default function TaskPlanner({
  tasks,
  onChange,
  crewOptions,
  areas = [],
  dayHours,
  onDayHours,
  accent = THEME.green,
  mode = 'plan',
}) {
  const [picking, setPicking] = useState(false);
  const reporting = mode === 'report';

  const allocation = useMemo(() => resolveTaskHours(tasks, dayHours), [tasks, dayHours]);
  const totals = useMemo(() => dayTotals(allocation), [allocation]);

  const setTask = (key, patch) => onChange(tasks.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const removeTask = (key) => onChange(tasks.filter((t) => t.key !== key));

  const addTasks = (names) => {
    onChange([
      ...tasks,
      ...names.map((name) => blankTask({ description: name, size_spec: specFor(name), open: false })),
    ]);
    setPicking(false);
  };

  const planned = tasks.filter((t) => t.goal_task_id);
  const extra = tasks.filter((t) => !t.goal_task_id);
  const answered = planned.filter((t) => t.status).length;

  // The common case on a good day: everything went to plan. One tap beats
  // three pills, and the crew already carries the planned hours.
  const markAllDone = () => onChange(tasks.map((t) => (t.goal_task_id && !t.status
    ? {
      ...t,
      status: 'met',
      crew: Object.fromEntries(Object.entries(t.crew).map(([id, c]) => [id, { ...c, worked: true }])),
    }
    : t)));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <div className="text-xs uppercase tracking-wide" style={{ color: THEME.textDim }}>
          {reporting ? 'Against the day’s goals' : 'Tasks'}
          <span className="ml-2" style={{ color: THEME.text }}>
            {reporting && planned.length > 0
              ? `${answered} of ${planned.length} answered`
              : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </span>
          {reporting && answered < planned.length && (
            <button
              type="button" onClick={markAllDone}
              className="ml-2 font-semibold normal-case tracking-normal"
              style={{ color: accent }}
            >
              Mark all done
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: THEME.textDim }}>
          Standard day
          <Input
            type="number" min="1" max="24" step="0.5" inputMode="decimal"
            aria-label="Standard working day in hours"
            style={{ width: 68, padding: '0.3rem 0.45rem' }}
            value={dayHours}
            onChange={(e) => onDayHours(e.target.value === '' ? '' : Number(e.target.value))}
          />
          h
        </label>
      </div>

      {reporting && planned.length > 0 && (
        <div className="space-y-2 mb-3">
          {planned.map((t) => (
            <TaskCard
              key={t.key} task={t} reporting crewOptions={crewOptions}
              allocation={allocation} totals={totals} dayHours={dayHours} accent={accent}
              onPatch={(p) => setTask(t.key, p)} onRemove={null}
            />
          ))}
        </div>
      )}

      {reporting && (
        <div className="text-xs uppercase tracking-wide mb-2 mt-4" style={{ color: THEME.textDim }}>
          Unplanned work
          <span className="ml-2 font-normal normal-case" style={{ color: THEME.textDim }}>
            — anything done today that wasn’t a goal
          </span>
        </div>
      )}

      <div className="space-y-2">
        {extra.map((t) => (
          <TaskCard
            key={t.key} task={t} reporting={false} crewOptions={crewOptions}
            allocation={allocation} totals={totals} dayHours={dayHours} accent={accent}
            onPatch={(p) => setTask(t.key, p)} onRemove={() => removeTask(t.key)}
          />
        ))}
      </div>

      {extra.length === 0 && !reporting && (
        <div className="text-xs py-3" style={{ color: THEME.textDim }}>
          No tasks yet — add the work this site should finish today.
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        <Btn type="button" variant="subtle" icon={Plus} onClick={() => setPicking(true)}>
          Add tasks
        </Btn>
      </div>

      <DayStrip totals={totals} crewOptions={crewOptions} dayHours={dayHours} />

      {/* One list for every card: the ids are shared, so this must not sit inside a task. */}
      <datalist id="site-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>

      <TaskPicker
        open={picking}
        accent={accent}
        already={tasks.map((t) => t.description)}
        onCancel={() => setPicking(false)}
        onAdd={addTasks}
      />
    </div>
  );
}

/* ------------------------------- one task -------------------------------- */

function TaskCard({ task, reporting, crewOptions, allocation, totals, dayHours, accent, onPatch, onRemove }) {
  const t = task;
  const crewIds = Object.keys(t.crew);
  const needsReason = reporting && (t.status === 'partial' || t.status === 'not_met');
  const tone = TASK_STATUS.find((s) => s.value === t.status)?.tone;
  const edge = reporting && tone ? THEME[tone] : THEME.border;

  return (
    <div className="rounded-lg" style={{ background: THEME.panel2, border: `1px solid ${edge}` }}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onPatch({ open: !t.open })}
            className="mt-0.5 shrink-0"
            style={{ color: THEME.textDim }}
            aria-label={t.open ? 'Hide details' : 'Show details'}
          >
            {t.open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          <div className="min-w-0 flex-1">
            {t.open ? (
              <Input
                list="task-catalogue"
                required
                placeholder="Pick from the list, or type the work"
                value={t.description}
                onChange={(e) => onPatch({ description: e.target.value, size_spec: specFor(e.target.value) || t.size_spec })}
              />
            ) : (
              <button type="button" className="text-left w-full" onClick={() => onPatch({ open: true })}>
                <div className="font-semibold truncate">{t.description || 'Untitled task'}</div>
                <div className="text-[11px] truncate" style={{ color: THEME.textDim }}>
                  {[t.size_spec, t.area].filter(Boolean).join(' · ') || 'No specification or location set'}
                </div>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Input
              type="number" min="0" step="any" inputMode="decimal"
              placeholder={reporting && t.planned_qty != null ? String(t.planned_qty) : 'Qty'}
              aria-label={reporting ? `Quantity done for ${t.description}` : `Target quantity for ${t.description}`}
              style={{ width: 66, padding: '0.35rem 0.45rem' }}
              value={t.qty}
              onChange={(e) => onPatch({ qty: e.target.value })}
            />
            <Select
              placeholder="Unit" options={UNITS.map((u) => ({ value: u.value, label: u.value }))}
              aria-label={`Unit for ${t.description}`}
              style={{ width: 86, padding: '0.35rem 0.45rem' }}
              value={t.unit} onChange={(e) => onPatch({ unit: e.target.value })}
            />
            {onRemove && <IconBtn icon={Trash2} title="Remove task" onClick={onRemove} />}
          </div>
        </div>

        {reporting && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${THEME.border}` }}>
              {TASK_STATUS.map((s) => {
                const on = t.status === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => onPatch({
                      status: on ? '' : s.value,
                      // Nothing was done, so nobody worked on it.
                      crew: s.value === 'not_met' && !on
                        ? Object.fromEntries(Object.entries(t.crew).map(([id, c]) => [id, { ...c, worked: false }]))
                        : Object.fromEntries(Object.entries(t.crew).map(([id, c]) => [id, { ...c, worked: true }])),
                    })}
                    className="px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: on ? THEME[s.tone] : 'transparent',
                      color: on ? '#14171A' : THEME.textDim,
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            {t.planned_qty != null && (
              <span className="text-[11px]" style={{ color: THEME.textDim }}>
                target {t.planned_qty} {t.unit ?? ''}
              </span>
            )}
          </div>
        )}

        {needsReason && (
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Where it stands now" required>
              <Input
                placeholder="e.g. pipe laid to grid 7, valves pending"
                value={t.status_note}
                onChange={(e) => onPatch({ status_note: e.target.value })}
              />
            </Field>
            <Field label="Reason for the delay" required>
              <Input
                list="delay-reasons"
                placeholder="Pick a reason, or type it"
                value={t.delay_reason}
                onChange={(e) => onPatch({ delay_reason: e.target.value })}
              />
            </Field>
          </div>
        )}

        {t.open && (
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Size / specification">
              <Input placeholder="e.g. 100 mm" value={t.size_spec}
                onChange={(e) => onPatch({ size_spec: e.target.value })} />
            </Field>
            <Field label="Location">
              <Input
                list="site-areas" placeholder="e.g. Basement 1 — Pump room"
                value={t.area} onChange={(e) => onPatch({ area: e.target.value })}
              />
            </Field>
            <Field label="Remarks" full>
              <Input placeholder="Anything worth noting about this task"
                value={t.remarks} onChange={(e) => onPatch({ remarks: e.target.value })} />
            </Field>
          </div>
        )}

        <CrewPicker
          task={t} reporting={reporting} crewOptions={crewOptions}
          allocation={allocation} totals={totals} dayHours={dayHours} accent={accent}
          onPatch={onPatch}
        />
      </div>

      {crewIds.length === 0 && reporting && t.status && t.status !== 'not_met' && (
        <div className="px-3 pb-2 text-[11px]" style={{ color: THEME.amber }}>
          Nobody is listed on this task.
        </div>
      )}
    </div>
  );
}

/* --------------------------------- crew ---------------------------------- */

function CrewPicker({ task, reporting, crewOptions, allocation, totals, dayHours, accent, onPatch }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const t = task;
  const picked = crewOptions.filter((e) => e.id in t.crew);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return crewOptions;
    return crewOptions.filter((e) => `${e.name} ${e.trade ?? ''}`.toLowerCase().includes(needle));
  }, [crewOptions, q]);

  const toggle = (id) => {
    const crew = { ...t.crew };
    if (id in crew) delete crew[id];
    else crew[id] = { hours: '', worked: t.status !== 'not_met' };
    onPatch({ crew });
  };

  const addAll = () => onPatch({
    crew: Object.fromEntries(matches.map((e) => [e.id, t.crew[e.id] ?? { hours: '', worked: t.status !== 'not_met' }])),
  });

  if (crewOptions.length === 0) {
    return (
      <div className="mt-2.5 text-xs" style={{ color: THEME.textDim }}>
        No workers on the roll for this site yet.
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide mr-0.5" style={{ color: THEME.textDim }}>
          <Users2 size={12} className="inline mr-1" />
          Crew {picked.length > 0 && `(${picked.length})`}
        </span>

        {picked.map((emp) => {
          const cell = t.crew[emp.id];
          const hours = allocation[cellKey(t.key, emp.id)] ?? 0;
          const auto = cell.hours === '';
          const off = reporting && cell.worked === false;
          const total = totals[emp.id] ?? 0;
          return (
            <span
              key={emp.id}
              className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs"
              style={{
                background: THEME.panel,
                border: `1px solid ${total > dayHours ? THEME.amber : THEME.border}`,
                opacity: off ? 0.45 : 1,
              }}
              title={off ? `${emp.name} did not work on this` : `${emp.name} — ${total} h across the day`}
            >
              {reporting && (
                <button
                  type="button"
                  onClick={() => onPatch({ crew: { ...t.crew, [emp.id]: { ...cell, worked: !cell.worked } } })}
                  className="flex items-center justify-center rounded-full shrink-0"
                  style={{
                    width: 15, height: 15,
                    background: off ? 'transparent' : accent,
                    border: `1px solid ${off ? THEME.textDim : accent}`,
                    color: '#14171A',
                  }}
                  aria-label={`${emp.name} worked on this task`}
                  aria-pressed={!off}
                >
                  {!off && <Check size={10} strokeWidth={3} />}
                </button>
              )}
              <span style={{ textDecoration: off ? 'line-through' : 'none' }}>{emp.name}</span>
              <input
                type="number" min="0" max="24" step="0.5" inputMode="decimal"
                aria-label={`Hours for ${emp.name} on ${t.description}`}
                placeholder={String(hours)}
                disabled={off}
                className="bg-transparent text-right outline-none"
                style={{ width: 32, color: auto ? THEME.textDim : THEME.text }}
                value={cell.hours}
                onChange={(e) => onPatch({ crew: { ...t.crew, [emp.id]: { ...cell, hours: e.target.value } } })}
              />
              <span className="text-[10px]" style={{ color: THEME.textDim }}>h</span>
              <button
                type="button" onClick={() => toggle(emp.id)}
                style={{ color: THEME.textDim }} aria-label={`Remove ${emp.name} from this task`}
              >
                <X size={13} />
              </button>
            </span>
          );
        })}

        <button
          type="button"
          onClick={() => { setOpen((o) => !o); setQ(''); }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold"
          style={{ border: `1px dashed ${accent}`, color: accent }}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg p-2" style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}>
          <div className="flex items-center gap-2 mb-2">
            <Search size={14} style={{ color: THEME.textDim }} />
            <input
              autoFocus placeholder="Search name or trade…" value={q} onChange={(e) => setQ(e.target.value)}
              className="bg-transparent outline-none text-sm flex-1" style={{ color: THEME.text }}
            />
            <button type="button" onClick={addAll} className="text-[11px] font-semibold" style={{ color: accent }}>
              Add all {q.trim() && `(${matches.length})`}
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto">
            {matches.length === 0 ? (
              <div className="text-xs py-2" style={{ color: THEME.textDim }}>Nobody matches “{q}”.</div>
            ) : matches.map((emp) => {
              const on = emp.id in t.crew;
              return (
                <button
                  key={emp.id} type="button" onClick={() => toggle(emp.id)}
                  className="flex items-center gap-2 w-full text-left px-1 py-1.5 rounded text-sm"
                  style={{ background: on ? THEME.panel2 : 'transparent' }}
                >
                  <span
                    className="flex items-center justify-center rounded shrink-0"
                    style={{
                      width: 16, height: 16,
                      background: on ? accent : 'transparent',
                      border: `1px solid ${on ? accent : THEME.border}`,
                      color: '#14171A',
                    }}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="truncate flex-1">{emp.name}</span>
                  {emp.trade && <span className="text-[11px]" style={{ color: THEME.textDim }}>{emp.trade}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end mt-1">
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold px-2 py-1" style={{ color: THEME.textDim }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------- the day, per worker ---------------------------- */

/**
 * Every worker on the day with their total hours. This is where the
 * cross-task timing problem becomes visible: one glance says whether anyone
 * has been double-booked or left half idle.
 */
function DayStrip({ totals, crewOptions, dayHours }) {
  const rows = crewOptions.filter((e) => totals[e.id] !== undefined);
  if (rows.length === 0) return null;
  const over = rows.filter((e) => totals[e.id] > dayHours);

  return (
    <div className="mt-4 rounded-lg p-3" style={{ background: THEME.panel2 }}>
      <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: THEME.textDim }}>
        The day, per worker — {rows.length} on site
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((emp) => {
          const h = totals[emp.id];
          const tone = h > dayHours ? THEME.amber : h < dayHours ? THEME.textDim : THEME.green;
          return (
            <span
              key={emp.id}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs"
              style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
            >
              {emp.name}
              <b style={{ color: tone }}>{h} h</b>
            </span>
          );
        })}
      </div>
      {over.length > 0 && (
        <div className="text-[11px] mt-2" style={{ color: THEME.amber }}>
          Over the {dayHours} h day: {over.map((e) => `${e.name} (${totals[e.id]} h)`).join(', ')}.
          Overtime is worked out from attendance, not from here — this is only a sanity check.
        </div>
      )}
    </div>
  );
}

/* ---------------------------- the task picker ----------------------------- */

/** Pick any number of tasks from the catalogue in one go, plus typed-in work. */
function TaskPicker({ open, accent, already, onCancel, onAdd }) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState([]);
  const [typed, setTyped] = useState([]);
  const [draft, setDraft] = useState('');

  const close = () => { setQ(''); setChosen([]); setTyped([]); setDraft(''); onCancel(); };

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DPR_TASKS;
    return DPR_TASKS.filter((t) => `${t.name} ${t.spec}`.toLowerCase().includes(needle));
  }, [q]);

  const total = chosen.length + typed.length;
  const addDraft = () => {
    const name = draft.trim();
    if (!name) return;
    setTyped((list) => (list.includes(name) ? list : [...list, name]));
    setDraft('');
  };

  return (
    <Modal open={open} onClose={close} accent={accent} title="Add tasks">
      <div className="text-sm">
        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 mb-3" style={{ background: THEME.panel2 }}>
          <Search size={15} style={{ color: THEME.textDim }} />
          <input
            autoFocus placeholder="Search the task list…" value={q} onChange={(e) => setQ(e.target.value)}
            className="bg-transparent outline-none flex-1" style={{ color: THEME.text }}
          />
        </div>

        <div className="max-h-64 overflow-y-auto -mx-1 px-1">
          {matches.length === 0 ? (
            <div className="text-xs py-3" style={{ color: THEME.textDim }}>
              Nothing in the list matches “{q}”. Type it in below instead.
            </div>
          ) : matches.map((t) => {
            const on = chosen.includes(t.name);
            const dup = already.includes(t.name);
            return (
              <button
                key={t.name} type="button"
                onClick={() => setChosen((c) => (on ? c.filter((n) => n !== t.name) : [...c, t.name]))}
                className="flex items-start gap-2.5 w-full text-left px-2 py-2 rounded-lg"
                style={{ background: on ? THEME.panel2 : 'transparent' }}
              >
                <span
                  className="flex items-center justify-center rounded shrink-0 mt-0.5"
                  style={{
                    width: 17, height: 17,
                    background: on ? accent : 'transparent',
                    border: `1px solid ${on ? accent : THEME.border}`,
                    color: '#14171A',
                  }}
                >
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">
                    {t.name}
                    {dup && <span className="text-[10px] ml-1.5" style={{ color: THEME.amber }}>already added</span>}
                  </span>
                  <span className="block text-[11px]" style={{ color: THEME.textDim }}>{t.spec}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${THEME.border}` }}>
          <Field label="Not on the list?">
            <div className="flex gap-2">
              <Input
                placeholder="Type the work, e.g. Shifting scaffold to level 3"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }}
              />
              <Btn type="button" variant="subtle" onClick={addDraft}>Add</Btn>
            </div>
          </Field>
          {typed.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {typed.map((name) => (
                <span
                  key={name} className="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-0.5 text-xs"
                  style={{ background: THEME.panel2, border: `1px solid ${THEME.border}` }}
                >
                  {name}
                  <button type="button" onClick={() => setTyped((l) => l.filter((n) => n !== name))}
                    style={{ color: THEME.textDim }} aria-label={`Remove ${name}`}>
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          <span className="text-xs" style={{ color: THEME.textDim }}>
            {total === 0 ? 'Nothing picked yet' : `${total} selected`}
          </span>
          <div className="flex gap-2">
            <Btn type="button" variant="subtle" onClick={close}>Cancel</Btn>
            <Btn
              type="button" accent={accent} disabled={total === 0}
              onClick={() => { onAdd([...chosen, ...typed]); close(); }}
            >
              {total === 0 ? 'Add' : `Add ${total}`}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** The catalogue datalist and delay-reason list, rendered once per form. */
export function TaskDatalists() {
  return (
    <>
      <datalist id="task-catalogue">
        {DPR_TASKS.map((t) => <option key={t.name} value={t.name} />)}
      </datalist>
      <datalist id="delay-reasons">
        {DELAY_REASONS.map((r) => <option key={r} value={r} />)}
      </datalist>
    </>
  );
}

/** Form tasks → the `tasks` array `save_goals` / `save_dpr` expect. */
export function tasksToPayload(tasks, dayHours, { reporting = false } = {}) {
  const allocation = resolveTaskHours(tasks, dayHours);
  return tasks
    .filter((t) => t.description.trim())
    .map((t) => ({
      ...(t.id ? { id: t.id } : {}),
      description: t.description.trim(),
      size_spec: t.size_spec.trim(),
      area: t.area.trim(),
      qty: t.qty === '' ? '' : String(Number(t.qty)),
      unit: t.unit,
      remarks: t.remarks.trim(),
      ...(reporting ? {
        goal_task_id: t.goal_task_id ?? '',
        status: t.status ?? '',
        planned_qty: t.planned_qty === null || t.planned_qty === undefined ? '' : String(t.planned_qty),
        status_note: t.status_note.trim(),
        delay_reason: t.delay_reason.trim(),
      } : {}),
      manpower: Object.entries(t.crew).map(([employee_id, cell]) => ({
        employee_id,
        hours: num(allocation[cellKey(t.key, employee_id)]),
        ...(reporting ? { worked: cell.worked !== false } : {}),
      })),
    }));
}
