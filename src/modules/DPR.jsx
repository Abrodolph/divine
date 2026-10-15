import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCheck, Pencil, Plus, Users2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, today } from '../lib/format';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { TASK_STATUS, WEATHER, statusLabel } from '../config/dprTasks';
import { DEFAULT_DAY_HOURS } from '../lib/taskHours';
import { AuditButton } from '../components/AuditTrail';
import TaskPlanner, { TaskDatalists, blankTask, taskFromRow, tasksToPayload } from '../components/TaskPlanner';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, IconBtn, Field, Input, TextArea,
  Select, SiteSelect, PhotoInput, PhotoStrip, Lightbox, Chip, Modal, FormError, Banner,
  SubHeading, LoadMore, DeleteBtn, ExportButton,
} from '../components/ui';

const MODULE = moduleByKey('dpr');
const GOALS = moduleByKey('goals');
const SELECT = '*, dpr_tasks(*, dpr_task_manpower(*))';
const GOAL_SELECT = '*, goal_tasks(*, goal_task_manpower(*))';

/** Tasks of a report, in the order they were entered. */
const tasksOf = (r) => [...(r?.dpr_tasks ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

/** The crew of a task, as [{ employee_id, hours, worked }]. */
const crewOf = (t) => t?.dpr_task_manpower ?? [];

const goalTasksOf = (sheet) => [...(sheet?.goal_tasks ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

/**
 * Daily Progress Report — the second half of the day's cycle.
 *
 * Goals set what the site was expected to deliver; this is where each one is
 * answered: done, part done or not done, with where the work stands and why it
 * slipped. Anything done that wasn't a goal is logged below as unplanned work.
 * The day is still the unit: today at the top, then every past day in reverse,
 * one card per site.
 */
export default function DPR() {
  const { siteFilter, siteName, empName } = useAppData();
  const { canEdit, canChangeRow, locks } = useAuth();
  const editable = canEdit('dpr') && !locks.dpr;

  const { rows, loading, error: loadError, remove, reload, hasMore, loadMore } = useRecords('dpr', {
    select: SELECT,
    orderBy: 'date',
    filters: [['site_id', 'eq', siteFilter]],
  });

  // Every goal sheet, so a day whose goals nobody has answered can raise
  // itself here instead of waiting to be remembered.
  const { rows: goalRows, reload: reloadGoals } = useRecords('goals', {
    select: GOAL_SELECT,
    orderBy: 'date',
    filters: [['site_id', 'eq', siteFilter]],
  });

  const [editing, setEditing] = useState(null); // null | 'new' | report row
  const [answering, setAnswering] = useState(null); // goal sheet id opened inline
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  // Which goals have been answered somewhere, by id.
  const answeredGoals = useMemo(() => {
    const seen = new Set();
    rows.forEach((r) => tasksOf(r).forEach((t) => { if (t.goal_task_id) seen.add(t.goal_task_id); }));
    return seen;
  }, [rows]);

  // A goal nobody has answered is a pending request. Derived, not stored: the
  // goals ARE the request, so there is no second source of truth to drift.
  // This also catches a goal added to a sheet after its report was filed —
  // and then the card edits that report rather than filing a second one for
  // the same day.
  const pending = useMemo(() => goalRows.flatMap((sheet) => {
    const goals = goalTasksOf(sheet);
    const unanswered = goals.filter((g) => !answeredGoals.has(g.id));
    if (!goals.length || !unanswered.length) return [];
    return [{
      sheet,
      unanswered,
      report: rows.find((r) => r.site_id === sheet.site_id && r.date === sheet.date) ?? null,
    }];
  }), [goalRows, rows, answeredGoals]);

  // date → the reports filed that day (one per site), newest day first.
  const days = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date).push(r);
    });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }, [rows]);

  const todayReports = days.find(([d]) => d === today())?.[1] ?? [];

  // One CSV row per task, so a day with five tasks exports as five lines.
  const exportRows = useMemo(() => rows.flatMap((r) => {
    const tasks = tasksOf(r);
    if (!tasks.length) return [{ report: r, task: null }];
    return tasks.map((t) => ({ report: r, task: t }));
  }), [rows]);

  const exportColumns = [
    { key: 'date', label: 'Date', value: ({ report }) => report.date ?? '' },
    { key: 'site', label: 'Site', value: ({ report }) => siteName(report.site_id) },
    { key: 'task', label: 'Task', value: ({ task, report }) => task?.description ?? report.work_done ?? '' },
    { key: 'planned', label: 'Planned?', value: ({ task }) => (task?.goal_task_id ? 'Goal' : task ? 'Unplanned' : '') },
    { key: 'outcome', label: 'Outcome', value: ({ task }) => statusLabel(task?.status) },
    { key: 'spec', label: 'Size / spec', value: ({ task }) => task?.size_spec ?? '' },
    { key: 'area', label: 'Location', value: ({ task }) => task?.area ?? '' },
    { key: 'target', label: 'Target qty', value: ({ task }) => ((task?.planned_qty ?? '') === '' ? '' : Number(task.planned_qty)) },
    { key: 'qty', label: 'Qty done', value: ({ task }) => ((task?.qty ?? '') === '' ? '' : Number(task.qty)) },
    { key: 'unit', label: 'Unit', value: ({ task }) => task?.unit ?? '' },
    { key: 'status_note', label: 'Where it stands', value: ({ task }) => task?.status_note ?? '' },
    { key: 'delay_reason', label: 'Reason for delay', value: ({ task }) => task?.delay_reason ?? '' },
    {
      key: 'crew',
      label: 'Crew',
      value: ({ task }) => crewOf(task).filter((m) => m.worked !== false).map((m) => empName(m.employee_id)).join(' | '),
    },
    {
      key: 'hours',
      label: 'Hours',
      value: ({ task }) => crewOf(task).filter((m) => m.worked !== false).map((m) => (m.hours ?? '')).join(' | '),
    },
    {
      key: 'absent',
      label: 'Planned but did not work',
      value: ({ task }) => crewOf(task).filter((m) => m.worked === false).map((m) => empName(m.employee_id)).join(' | '),
    },
    { key: 'weather', label: 'Weather', value: ({ report }) => report.weather ?? '' },
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
        title="Daily Progress"
        subtitle="Were today's goals met? Answer each one, and log anything else that got done"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="dpr.csv" columns={exportColumns} rows={exportRows} />}
      />

      <LockBanner locked={!!locks.dpr} readOnly={!canEdit('dpr') && !locks.dpr} />

      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: THEME.textDim }}>Today</div>
            <div className="text-lg" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>{fmtDate(today())}</div>
            <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
              {todayReports.length === 0
                ? 'No report filed yet.'
                : `${todayReports.length} report${todayReports.length > 1 ? 's' : ''} filed: ${todayReports.map((r) => siteName(r.site_id)).join(', ')}`}
            </div>
          </div>
          {editable && (
            <Btn variant="subtle" icon={Plus} onClick={() => { setError(null); setEditing('new'); }}>
              Report without goals
            </Btn>
          )}
        </div>
      </Card>

      {(error || loadError) && <Banner tone="red">{error || loadError}</Banner>}

      {pending.length > 0 && (
        <div className="mb-6">
          <SubHeading className="mb-2" action={(
            <span className="text-[11px] font-normal" style={{ color: THEME.amber }}>
              {pending.length} waiting
            </span>
          )}>
            AWAITING CONFIRMATION
          </SubHeading>
          <div className="text-xs mb-2" style={{ color: THEME.textDim }}>
            Goals were set for these days and nobody has said yet whether they were met.
          </div>
          <div className="space-y-3">
            {pending.map((item) => (
              <PendingCard
                key={item.sheet.id}
                item={item}
                siteName={siteName}
                editable={editable}
                open={answering === item.sheet.id}
                onOpen={() => { setError(null); setAnswering(answering === item.sheet.id ? null : item.sheet.id); }}
                onDone={() => { setAnswering(null); reload(); reloadGoals(); }}
              />
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            label="No daily reports yet."
            hint={pending.length > 0
              ? 'Answer the goals waiting above to file the first one.'
              : 'Set a site\'s goals for the day and the report to confirm them appears here on its own.'}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map(([date, reports]) => (
            <div key={date}>
              <SubHeading className="mb-2">
                {fmtDate(date)}
                {date === today() && <span className="ml-2 text-[11px]" style={{ color: MODULE.accent }}>TODAY</span>}
              </SubHeading>
              <div className="space-y-3">
                {reports.map((r) => (
                  <ReportCard
                    key={r.id}
                    report={r}
                    siteName={siteName}
                    empName={empName}
                    onPhoto={setLightbox}
                    actions={(
                      <>
                        <AuditButton table="dpr" rowId={r.id} />
                        {editable && canChangeRow(r) && (
                          <>
                            <IconBtn icon={Pencil} title="Edit report" onClick={() => { setError(null); setEditing(r); }} />
                            <DeleteBtn onDelete={() => del(r.id)} label="this report" />
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
        title={editing === 'new' ? 'Daily progress report' : `Edit report — ${editing ? fmtDate(editing.date) : ''}`}
      >
        {editing && (
          <DprForm
            report={editing === 'new' ? null : editing}
            onDone={() => { setEditing(null); reload(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/* --------------------------------- card ---------------------------------- */

function ReportCard({ report, siteName, empName, actions, onPhoto }) {
  const tasks = tasksOf(report);
  const planned = tasks.filter((t) => t.goal_task_id);
  const met = planned.filter((t) => t.status === 'met');
  const slipped = planned.filter((t) => t.status === 'partial' || t.status === 'not_met');

  return (
    <Card className="p-4">
      <div className="flex justify-between items-start gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
            {siteName(report.site_id)}
          </div>
          <div className="text-xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: THEME.textDim }}>
            {planned.length > 0 && (
              <Chip tone={met.length === planned.length ? 'green' : slipped.length ? 'amber' : 'dim'}>
                {met.length} of {planned.length} goals met
              </Chip>
            )}
            {report.weather && <Chip tone="dim">{report.weather}</Chip>}
            {report.manpower ? (
              <span className="inline-flex items-center gap-1"><Users2 size={12} /> {report.manpower} on site</span>
            ) : null}
            {report.reported_by && <span>by {report.reported_by}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">{actions}</div>
      </div>

      {tasks.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm">
          {tasks.map((t) => {
            const crew = crewOf(t);
            const worked = crew.filter((m) => m.worked !== false);
            const absent = crew.filter((m) => m.worked === false);
            const tone = TASK_STATUS.find((s) => s.value === t.status)?.tone;
            return (
              <li key={t.id} className="flex items-start gap-2">
                <span
                  className="mt-1.5 shrink-0 rounded-full"
                  style={{ width: 7, height: 7, background: tone ? THEME[tone] : THEME.border }}
                  title={t.status ? statusLabel(t.status) : 'Unplanned work'}
                />
                <div className="min-w-0">
                  <div>
                    <b>{t.description}</b>
                    {[t.size_spec, t.area].filter(Boolean).map((bit) => <span key={bit}> · {bit}</span>)}
                    {t.qty !== null && t.qty !== undefined && t.qty !== '' && (
                      <span>
                        {' · '}{Number(t.qty)}
                        {t.planned_qty !== null && t.planned_qty !== undefined && Number(t.planned_qty) !== Number(t.qty)
                          ? ` of ${Number(t.planned_qty)}` : ''}
                        {' '}{t.unit ?? ''}
                      </span>
                    )}
                    {t.status ? (
                      <span className="text-[11px] ml-2 font-semibold" style={{ color: tone ? THEME[tone] : THEME.textDim }}>
                        {statusLabel(t.status)}
                      </span>
                    ) : (
                      <span className="text-[11px] ml-2" style={{ color: THEME.textDim }}>unplanned</span>
                    )}
                  </div>
                  {t.status_note && (
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>Now: {t.status_note}</div>
                  )}
                  {t.delay_reason && (
                    <div className="text-xs mt-0.5" style={{ color: THEME.amber }}>Why: {t.delay_reason}</div>
                  )}
                  {worked.length > 0 && (
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                      {worked.map((m) => `${empName(m.employee_id)}${m.hours ? ` (${Number(m.hours)} h)` : ''}`).join(', ')}
                    </div>
                  )}
                  {absent.length > 0 && (
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                      Did not work on this: {absent.map((m) => empName(m.employee_id)).join(', ')}
                    </div>
                  )}
                  {t.remarks && <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>{t.remarks}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : report.work_done ? (
        <div className="mt-3 text-sm whitespace-pre-line">{report.work_done}</div>
      ) : (
        <div className="mt-3 text-xs" style={{ color: THEME.textDim }}>No tasks listed.</div>
      )}

      {report.material_used && (
        <div className="text-xs mt-3" style={{ color: THEME.textDim }}>Material: {report.material_used}</div>
      )}
      {report.issues && (
        <div className="text-xs mt-1" style={{ color: THEME.amber }}>Issues: {report.issues}</div>
      )}
      {report.photos?.length > 0 && (
        <div className="mt-3"><PhotoStrip photos={report.photos} onOpen={onPhoto} size={44} /></div>
      )}
    </Card>
  );
}

/* ------------------------- awaiting confirmation -------------------------- */

/**
 * A goal sheet nobody has answered yet, raised on this screen on its own.
 *
 * Setting goals is what creates the request, so there is nothing to click to
 * start a report: the day is already here, waiting to be confirmed or denied.
 * Answering happens in place — the card opens into the report form with its
 * site and date already settled.
 */
function PendingCard({ item, siteName, editable, open, onOpen, onDone }) {
  const { sheet, unanswered, report } = item;
  const late = sheet.date < today();
  const n = unanswered.length;

  return (
    <Card className="p-4" style={{ borderColor: late ? THEME.amber : THEME.border }}>
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
            {siteName(sheet.site_id)}
          </div>
          <div className="text-xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: THEME.textDim }}>
            <span>{fmtDate(sheet.date)}</span>
            <Chip tone={report ? 'blue' : late ? 'amber' : 'blue'}>
              {report
                ? `${n} goal${n === 1 ? '' : 's'} added after the report`
                : late ? 'Not answered' : 'Due today'}
            </Chip>
            {!report && <span>{n} goal{n === 1 ? '' : 's'}</span>}
            {sheet.set_by && <span>set by {sheet.set_by}</span>}
          </div>
        </div>
        {editable && (
          <Btn
            accent={MODULE.accent}
            variant={open ? 'subtle' : 'primary'}
            icon={open ? undefined : ClipboardCheck}
            onClick={onOpen}
          >
            {open ? 'Not now' : report ? 'Update report' : 'Answer goals'}
          </Btn>
        )}
      </div>

      {!open && (
        <ul className="mt-3 space-y-1 text-sm">
          {unanswered.map((g) => (
            <li key={g.id} className="flex items-start gap-2">
              <span className="mt-1.5 shrink-0 rounded-full" style={{ width: 7, height: 7, background: THEME.border }} />
              <span className="min-w-0">
                {g.description}
                {g.qty !== null && g.qty !== undefined && (
                  <span style={{ color: THEME.textDim }}> · target {Number(g.qty)} {g.unit ?? ''}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${THEME.border}` }}>
          <DprForm
            report={report}
            fixed={{ date: sheet.date, site_id: sheet.site_id }}
            sheet={sheet}
            inline
            onDone={onDone}
            onCancel={onOpen}
          />
        </div>
      )}
    </Card>
  );
}

/* --------------------------------- form ---------------------------------- */

/**
 * Fold the day's goal sheet into the task list being edited.
 *
 * Every goal becomes a task to answer, carrying its target quantity and
 * planned crew. A goal already answered in this report keeps the answer. A
 * task that pointed at a goal which is no longer on the sheet (the date or
 * site changed, or the goal was deleted) survives as unplanned work rather
 * than being thrown away with whatever was typed into it.
 */
export function mergeGoals(existing, sheet) {
  const goals = goalTasksOf(sheet);
  const live = new Set(goals.map((g) => g.id));
  const answered = new Map(existing.filter((t) => t.goal_task_id).map((t) => [t.goal_task_id, t]));

  const planned = goals.map((g) => {
    const had = answered.get(g.id);
    if (had) return { ...had, planned_qty: g.qty ?? null };
    return taskFromRow(g, g.goal_task_manpower ?? [], {
      key: `g${g.id}`,
      id: null,
      goal_task_id: g.id,
      planned_qty: g.qty ?? null,
      qty: '',  // what was achieved is typed on the report, not inherited
      open: false,
    });
  });

  const unplanned = existing
    .filter((t) => !t.goal_task_id || !live.has(t.goal_task_id))
    .map((t) => (t.goal_task_id
      ? { ...t, goal_task_id: null, planned_qty: null, status: '', status_note: '', delay_reason: '' }
      : t))
    .filter((t) => t.description.trim() || goals.length === 0);

  return [...planned, ...unplanned];
}

function DprForm({ report, fixed = null, sheet: givenSheet = null, inline = false, onDone, onCancel }) {
  const { activeSites, activeEmployees, siteAreas, siteFilter, rules } = useAppData();
  const { profile } = useAuth();

  const [head, setHead] = useState(() => ({
    date: fixed?.date ?? report?.date ?? today(),
    site_id: fixed?.site_id ?? report?.site_id ?? siteFilter ?? '',
    weather: report?.weather ?? '',
    reported_by: report?.reported_by ?? profile?.name ?? '',
    material_used: report?.material_used ?? '',
    issues: report?.issues ?? '',
    photos: report?.photos ?? [],
  }));
  const [dayHours, setDayHours] = useState(() => Number(rules?.standard_hours) || DEFAULT_DAY_HOURS);
  const [tasks, setTasks] = useState(() => {
    const existing = tasksOf(report);
    if (!existing.length) return [blankTask()];
    return existing.map((t) => taskFromRow(t, crewOf(t), {
      goal_task_id: t.goal_task_id ?? null,
      planned_qty: t.planned_qty ?? null,
      status: t.status ?? '',
      status_note: t.status_note ?? '',
      delay_reason: t.delay_reason ?? '',
    }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // The goal sheet for whatever date and site the form is pointed at. When the
  // pending card already has it loaded, use that rather than fetching it twice.
  const { rows: goalRows, loading: fetching } = useRecords('goals', {
    select: GOAL_SELECT,
    orderBy: 'date',
    filters: [['site_id', 'eq', head.site_id], ['date', 'eq', head.date]],
    enabled: !givenSheet && !!head.site_id && !!head.date,
  });
  const sheet = givenSheet ?? goalRows[0] ?? null;
  const goalsLoading = givenSheet ? false : fetching;
  const sheetKey = sheet ? `${sheet.id}:${sheet.goal_tasks?.length ?? 0}` : `none:${head.site_id}:${head.date}`;

  useEffect(() => {
    if (goalsLoading) return;  // don't strip the report's own goals while loading
    setTasks((ts) => mergeGoals(ts, sheet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsLoading, sheetKey]);

  // Inline, the day's extra detail starts out of the way: the question on
  // screen is whether the goals were met, not what the weather was.
  const [more, setMore] = useState(!inline);

  const areas = useMemo(() => siteAreas(head.site_id).map((a) => a.name), [siteAreas, head.site_id]);

  const crewOptions = useMemo(() => {
    if (!head.site_id) return activeEmployees;
    return activeEmployees.filter((e) => e.site_id === head.site_id || !e.site_id);
  }, [activeEmployees, head.site_id]);

  const planned = tasks.filter((t) => t.goal_task_id);
  const unanswered = planned.filter((t) => !t.status);

  async function save(e) {
    e.preventDefault();
    if (!head.date) { setError('Pick the date.'); return; }
    if (!head.site_id) { setError('Choose the site.'); return; }

    const filled = tasks.filter((t) => t.description.trim());
    if (!filled.length) { setError('Add at least one task.'); return; }
    if (unanswered.length) {
      setError(`Answer every goal first — ${unanswered.length} still unmarked.`);
      return;
    }
    const missing = planned.find(
      (t) => (t.status === 'partial' || t.status === 'not_met') && (!t.status_note.trim() || !t.delay_reason.trim())
    );
    if (missing) {
      setError(`Say where "${missing.description}" stands now and why it slipped.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc('save_dpr', {
        p: {
          ...(report ? { id: report.id } : {}),
          date: head.date,
          site_id: head.site_id,
          weather: head.weather,
          material_used: head.material_used,
          issues: head.issues,
          reported_by: head.reported_by,
          work_done: report?.work_done ?? '',
          photos: head.photos,
          tasks: tasksToPayload(tasks, dayHours, { reporting: true }),
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
      {!inline && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date" required>
            <Input type="date" required max={today()} value={head.date}
              onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))} />
          </Field>
          <Field label="Site" required>
            <SiteSelect sites={activeSites} required value={head.site_id}
              onChange={(e) => setHead((h) => ({ ...h, site_id: e.target.value }))} />
          </Field>
          <Field label="Weather">
            <Select options={WEATHER} value={head.weather}
              onChange={(e) => setHead((h) => ({ ...h, weather: e.target.value }))} />
          </Field>
          <Field label="Reported by">
            <Input value={head.reported_by}
              onChange={(e) => setHead((h) => ({ ...h, reported_by: e.target.value }))} />
          </Field>
        </div>
      )}

      {!inline && head.site_id && head.date && !goalsLoading && planned.length === 0 && (
        <Banner tone="blue">
          No goals were set for this site on this date, so there is nothing to confirm — log the day's work below.
          Setting goals each morning is what makes this report a check rather than a diary.
        </Banner>
      )}

      {sheet?.note && (
        <div className="text-xs rounded-lg p-3" style={{ background: THEME.panel2, color: THEME.textDim }}>
          <span className="uppercase tracking-wide" style={{ color: GOALS.accent }}>Note with the goals</span>
          <div className="mt-1" style={{ color: THEME.text }}>{sheet.note}</div>
        </div>
      )}

      <TaskPlanner
        mode="report"
        tasks={tasks}
        onChange={setTasks}
        crewOptions={crewOptions}
        areas={areas}
        dayHours={dayHours}
        onDayHours={setDayHours}
        accent={MODULE.accent}
      />

      {inline && (
        <button
          type="button" onClick={() => setMore((m) => !m)}
          className="flex items-center gap-1 text-xs font-semibold"
          style={{ color: MODULE.accent }}
        >
          {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Weather, material, issues & photos
        </button>
      )}

      {more && (
        <>
          {inline && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Weather">
                <Select options={WEATHER} value={head.weather}
                  onChange={(e) => setHead((h) => ({ ...h, weather: e.target.value }))} />
              </Field>
              <Field label="Reported by">
                <Input value={head.reported_by}
                  onChange={(e) => setHead((h) => ({ ...h, reported_by: e.target.value }))} />
              </Field>
            </div>
          )}
          <Field label="Material consumed">
            <TextArea rows={2} value={head.material_used}
              onChange={(e) => setHead((h) => ({ ...h, material_used: e.target.value }))} />
          </Field>
          <Field label="Issues / delays" hint="Anything that held the whole day up — a per-goal reason goes on the goal itself.">
            <TextArea rows={2} value={head.issues}
              onChange={(e) => setHead((h) => ({ ...h, issues: e.target.value }))} />
          </Field>
          <Field label="Photos">
            <PhotoInput value={head.photos} onChange={(v) => setHead((h) => ({ ...h, photos: v }))} folder="dpr" max={6} />
          </Field>
        </>
      )}

      <TaskDatalists />
      <FormError error={error} />
      <div className="flex items-center justify-end gap-2">
        {unanswered.length > 0 && (
          <span className="text-[11px] mr-auto" style={{ color: THEME.amber }}>
            {unanswered.length} goal{unanswered.length === 1 ? '' : 's'} still to answer
          </span>
        )}
        <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" accent={MODULE.accent} disabled={saving}>
          {saving ? 'Saving…' : report ? 'Save changes' : 'File report'}
        </Btn>
      </div>
    </form>
  );
}
