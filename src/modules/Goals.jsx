import { useMemo, useState } from 'react';
import { Pencil, Plus, Users2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, today } from '../lib/format';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { TASK_STATUS, statusLabel } from '../config/dprTasks';
import { DEFAULT_DAY_HOURS } from '../lib/taskHours';
import { AuditButton } from '../components/AuditTrail';
import TaskPlanner, { TaskDatalists, blankTask, taskFromRow, tasksToPayload } from '../components/TaskPlanner';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, IconBtn, Field, Input, TextArea,
  SiteSelect, Chip, Modal, FormError, Banner, SubHeading, LoadMore, DeleteBtn, ExportButton,
} from '../components/ui';

const MODULE = moduleByKey('goals');
const SELECT = '*, goal_tasks(*, goal_task_manpower(*))';

/** Tasks of a goal sheet, in the order they were set. */
const tasksOf = (g) => [...(g?.goal_tasks ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
const crewOf = (t) => t?.goal_task_manpower ?? [];

/**
 * Goals — the first half of the day's cycle.
 *
 * In the morning a site's goals are set: the tasks it is expected to finish,
 * with a target quantity and the crew meant to be on each. In the evening the
 * Daily Progress Report answers them one by one — met, part done or not done,
 * with a reason. This screen sets the expectation and shows how it turned out.
 */
export default function Goals() {
  const { siteFilter, siteName, empName } = useAppData();
  const { canEdit, canChangeRow, locks } = useAuth();
  const editable = canEdit('goals') && !locks.goals;

  const { rows, loading, error: loadError, remove, reload, hasMore, loadMore } = useRecords('goals', {
    select: SELECT,
    orderBy: 'date',
    filters: [['site_id', 'eq', siteFilter]],
  });

  // How the DPR answered each goal task: goal_task_id → 'met' | 'partial' | 'not_met'.
  const { rows: answerRows } = useRecords('dpr_tasks', {
    select: 'goal_task_id, status',
    orderBy: 'created_at',
    filters: [['goal_task_id', 'notnull']],
    pageSize: 1000,
  });
  const answers = useMemo(() => {
    const m = {};
    answerRows.forEach((r) => { if (r.goal_task_id) m[r.goal_task_id] = r.status; });
    return m;
  }, [answerRows]);

  const [editing, setEditing] = useState(null); // null | 'new' | goal row
  const [error, setError] = useState(null);

  const days = useMemo(() => {
    const m = new Map();
    rows.forEach((g) => {
      if (!m.has(g.date)) m.set(g.date, []);
      m.get(g.date).push(g);
    });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }, [rows]);

  const todaySheets = days.find(([d]) => d === today())?.[1] ?? [];
  const todayTasks = todaySheets.reduce((n, g) => n + tasksOf(g).length, 0);

  const exportRows = useMemo(() => rows.flatMap((g) => {
    const tasks = tasksOf(g);
    if (!tasks.length) return [{ goal: g, task: null }];
    return tasks.map((t) => ({ goal: g, task: t }));
  }), [rows]);

  const exportColumns = [
    { key: 'date', label: 'Date', value: ({ goal }) => goal.date ?? '' },
    { key: 'site', label: 'Site', value: ({ goal }) => siteName(goal.site_id) },
    { key: 'task', label: 'Goal', value: ({ task }) => task?.description ?? '' },
    { key: 'spec', label: 'Size / spec', value: ({ task }) => task?.size_spec ?? '' },
    { key: 'area', label: 'Location', value: ({ task }) => task?.area ?? '' },
    { key: 'qty', label: 'Target qty', value: ({ task }) => ((task?.qty ?? '') === '' ? '' : Number(task.qty)) },
    { key: 'unit', label: 'Unit', value: ({ task }) => task?.unit ?? '' },
    { key: 'crew', label: 'Planned crew', value: ({ task }) => crewOf(task).map((m) => empName(m.employee_id)).join(' | ') },
    { key: 'hours', label: 'Planned hours', value: ({ task }) => crewOf(task).map((m) => (m.hours ?? '')).join(' | ') },
    { key: 'outcome', label: 'Outcome', value: ({ task }) => (task ? statusLabel(answers[task.id]) || 'Not reported' : '') },
    { key: 'set_by', label: 'Set by', value: ({ goal }) => goal.set_by ?? '' },
  ];

  async function del(id) {
    setError(null);
    try {
      await remove(id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Goals"
        subtitle="What each site is expected to finish today — the Daily Progress Report answers them"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="goals.csv" columns={exportColumns} rows={exportRows} />}
      />

      <LockBanner locked={!!locks.goals} readOnly={!canEdit('goals') && !locks.goals} />

      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: THEME.textDim }}>Today</div>
            <div className="text-lg" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>{fmtDate(today())}</div>
            <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
              {todaySheets.length === 0
                ? 'No goals set yet — set them before work starts.'
                : `${todayTasks} goal${todayTasks === 1 ? '' : 's'} set for ${todaySheets.map((g) => siteName(g.site_id)).join(', ')}`}
            </div>
          </div>
          {editable && (
            <Btn accent={MODULE.accent} icon={Plus} onClick={() => { setError(null); setEditing('new'); }}>
              {todaySheets.length === 0 ? 'Set goals' : 'Set goals'}
            </Btn>
          )}
        </div>
      </Card>

      {(error || loadError) && <Banner tone="red">{error || loadError}</Banner>}

      {loading ? (
        <Loading />
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            label="No goals set yet."
            hint={editable ? 'Tap "Set goals" to say what today should deliver.' : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map(([date, sheets]) => (
            <div key={date}>
              <SubHeading className="mb-2">
                {fmtDate(date)}
                {date === today() && <span className="ml-2 text-[11px]" style={{ color: MODULE.accent }}>TODAY</span>}
              </SubHeading>
              <div className="space-y-3">
                {sheets.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    answers={answers}
                    siteName={siteName}
                    empName={empName}
                    actions={(
                      <>
                        <AuditButton table="goals" rowId={g.id} />
                        {editable && canChangeRow(g) && (
                          <>
                            <IconBtn icon={Pencil} title="Edit goals" onClick={() => { setError(null); setEditing(g); }} />
                            <DeleteBtn onDelete={() => del(g.id)} label="this goal sheet" />
                          </>
                        )}
                      </>
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
          <LoadMore hasMore={hasMore} onClick={loadMore} />
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        accent={MODULE.accent}
        title={editing === 'new' ? 'Goals for the day' : `Edit goals — ${editing ? fmtDate(editing.date) : ''}`}
      >
        {editing && (
          <GoalForm
            goal={editing === 'new' ? null : editing}
            onDone={() => { setEditing(null); reload(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

/* --------------------------------- card ---------------------------------- */

function GoalCard({ goal, answers, siteName, empName, actions }) {
  const tasks = tasksOf(goal);
  const reported = tasks.filter((t) => answers[t.id]);
  const met = tasks.filter((t) => answers[t.id] === 'met');

  return (
    <Card className="p-4">
      <div className="flex justify-between items-start gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
            {siteName(goal.site_id)}
          </div>
          <div className="text-xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: THEME.textDim }}>
            <Chip tone={reported.length === 0 ? 'dim' : met.length === tasks.length ? 'green' : 'amber'}>
              {reported.length === 0
                ? 'Not reported yet'
                : `${met.length} of ${tasks.length} done`}
            </Chip>
            {goal.set_by && <span>set by {goal.set_by}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">{actions}</div>
      </div>

      {tasks.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm">
          {tasks.map((t) => {
            const crew = crewOf(t);
            const status = answers[t.id];
            const tone = TASK_STATUS.find((s) => s.value === status)?.tone;
            return (
              <li key={t.id}>
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1.5 shrink-0 rounded-full"
                    style={{ width: 7, height: 7, background: tone ? THEME[tone] : THEME.border }}
                    title={status ? statusLabel(status) : 'Not reported yet'}
                  />
                  <div className="min-w-0">
                    <div>
                      <b>{t.description}</b>
                      {[t.size_spec, t.area].filter(Boolean).map((bit) => <span key={bit}> · {bit}</span>)}
                      {t.qty !== null && t.qty !== undefined && t.qty !== '' && (
                        <span> · target {Number(t.qty)} {t.unit ?? ''}</span>
                      )}
                      {status && (
                        <span className="text-[11px] ml-2" style={{ color: tone ? THEME[tone] : THEME.textDim }}>
                          {statusLabel(status)}
                        </span>
                      )}
                    </div>
                    {crew.length > 0 && (
                      <div className="text-xs mt-0.5 flex items-center gap-1" style={{ color: THEME.textDim }}>
                        <Users2 size={12} />
                        {crew.map((m) => `${empName(m.employee_id)}${m.hours ? ` (${Number(m.hours)} h)` : ''}`).join(', ')}
                      </div>
                    )}
                    {t.remarks && <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>{t.remarks}</div>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 text-xs" style={{ color: THEME.textDim }}>No goals listed.</div>
      )}

      {goal.note && (
        <div className="text-xs mt-3" style={{ color: THEME.textDim }}>{goal.note}</div>
      )}
    </Card>
  );
}

/* --------------------------------- form ---------------------------------- */

function GoalForm({ goal, onDone, onCancel }) {
  const { activeSites, activeEmployees, siteAreas, siteFilter, rules } = useAppData();
  const { profile } = useAuth();

  const [head, setHead] = useState(() => ({
    date: goal?.date ?? today(),
    site_id: goal?.site_id ?? siteFilter ?? '',
    set_by: goal?.set_by ?? profile?.name ?? '',
    note: goal?.note ?? '',
  }));
  const [dayHours, setDayHours] = useState(
    () => Number(rules?.standard_hours) || DEFAULT_DAY_HOURS
  );
  const [tasks, setTasks] = useState(() => {
    const existing = tasksOf(goal);
    if (!existing.length) return [blankTask()];
    return existing.map((t) => taskFromRow(t, crewOf(t)));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const areas = useMemo(() => siteAreas(head.site_id).map((a) => a.name), [siteAreas, head.site_id]);

  const crewOptions = useMemo(() => {
    if (!head.site_id) return activeEmployees;
    return activeEmployees.filter((e) => e.site_id === head.site_id || !e.site_id);
  }, [activeEmployees, head.site_id]);

  async function save(e) {
    e.preventDefault();
    if (!head.date) { setError('Pick the date.'); return; }
    if (!head.site_id) { setError('Choose the site.'); return; }
    const filled = tasks.filter((t) => t.description.trim());
    if (!filled.length) { setError('Add at least one goal for the day.'); return; }

    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc('save_goals', {
        p: {
          ...(goal ? { id: goal.id } : {}),
          date: head.date,
          site_id: head.site_id,
          set_by: head.set_by,
          note: head.note,
          tasks: tasksToPayload(tasks, dayHours),
        },
      });
      if (err) throw new Error(friendly(err));
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Date" required>
          <Input type="date" required value={head.date}
            onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))} />
        </Field>
        <Field label="Site" required>
          <SiteSelect sites={activeSites} required value={head.site_id}
            onChange={(e) => setHead((h) => ({ ...h, site_id: e.target.value }))} />
        </Field>
        <Field label="Set by">
          <Input value={head.set_by}
            onChange={(e) => setHead((h) => ({ ...h, set_by: e.target.value }))} />
        </Field>
      </div>

      <TaskPlanner
        mode="plan"
        tasks={tasks}
        onChange={setTasks}
        crewOptions={crewOptions}
        areas={areas}
        dayHours={dayHours}
        onDayHours={setDayHours}
        accent={MODULE.accent}
      />

      <Field label="Note for the site" hint="Priorities, a deadline, anything the crew should know before starting.">
        <TextArea rows={2} value={head.note}
          onChange={(e) => setHead((h) => ({ ...h, note: e.target.value }))} />
      </Field>

      <TaskDatalists />
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" accent={MODULE.accent} disabled={saving}>
          {saving ? 'Saving…' : goal ? 'Save changes' : 'Set goals'}
        </Btn>
      </div>
    </form>
  );
}
