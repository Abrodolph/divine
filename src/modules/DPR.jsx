import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Users2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, today } from '../lib/format';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { UNITS } from '../config/fields';
import { DPR_TASK_NAMES, WEATHER, specFor } from '../config/dprTasks';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, IconBtn, Field, Input, TextArea,
  Select, SiteSelect, PhotoInput, PhotoStrip, Lightbox, Chip, Modal, FormError, Banner,
  SubHeading, LoadMore, DeleteBtn, ExportButton,
} from '../components/ui';

const MODULE = moduleByKey('dpr');
const SELECT = '*, dpr_tasks(*, dpr_task_manpower(*))';

const blankTask = () => ({
  key: `t${Math.random().toString(36).slice(2)}`,
  description: '', size_spec: '', area: '', qty: '', unit: '', remarks: '', crew: {},
});

/** Tasks of a report, in the order they were entered. */
const tasksOf = (r) => [...(r?.dpr_tasks ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

/** The crew of a task, as [{ employee_id, hours }]. */
const crewOf = (t) => t?.dpr_task_manpower ?? [];

/**
 * Daily Progress Report — date-wise.
 *
 * The day is the unit: today sits at the top with "Add DPR", and below it every
 * past day in reverse order, one card per site, each listing the tasks done
 * there and the crew (with hours) that worked on each.
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

  const [editing, setEditing] = useState(null); // null | 'new' | report row
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

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
    { key: 'spec', label: 'Size / spec', value: ({ task }) => task?.size_spec ?? '' },
    { key: 'area', label: 'Location', value: ({ task }) => task?.area ?? '' },
    { key: 'qty', label: 'Qty', value: ({ task }) => (task?.qty ?? '') === '' ? '' : Number(task.qty) },
    { key: 'unit', label: 'Unit', value: ({ task }) => task?.unit ?? '' },
    { key: 'crew', label: 'Crew', value: ({ task }) => crewOf(task).map((m) => empName(m.employee_id)).join(' | ') },
    { key: 'hours', label: 'Hours', value: ({ task }) => crewOf(task).map((m) => (m.hours ?? '')).join(' | ') },
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
        subtitle="What was done on site today — task by task, with the crew on each"
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
            <Btn accent={MODULE.accent} icon={Plus} onClick={() => { setError(null); setEditing('new'); }}>Add DPR</Btn>
          )}
        </div>
      </Card>

      {(error || loadError) && <Banner tone="red">{error || loadError}</Banner>}

      {loading ? (
        <Loading />
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            label="No daily reports yet."
            hint={editable ? 'Tap "Add DPR" to file today\'s progress.' : undefined}
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
  return (
    <Card className="p-4">
      <div className="flex justify-between items-start gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
            {siteName(report.site_id)}
          </div>
          <div className="text-xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: THEME.textDim }}>
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
            return (
              <li key={t.id}>
                <div>
                  • <b>{t.description}</b>
                  {[t.size_spec, t.area].filter(Boolean).map((bit) => <span key={bit}> · {bit}</span>)}
                  {t.qty !== null && t.qty !== undefined && t.qty !== '' && (
                    <span> · {Number(t.qty)} {t.unit ?? ''}</span>
                  )}
                </div>
                {crew.length > 0 && (
                  <div className="text-xs mt-0.5 pl-3" style={{ color: THEME.textDim }}>
                    {crew.map((m) => `${empName(m.employee_id)}${m.hours ? ` (${Number(m.hours)} h)` : ''}`).join(', ')}
                  </div>
                )}
                {t.remarks && <div className="text-xs mt-0.5 pl-3" style={{ color: THEME.textDim }}>{t.remarks}</div>}
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

/* --------------------------------- form ---------------------------------- */

function DprForm({ report, onDone, onCancel }) {
  const { activeSites, activeEmployees, siteAreas, siteFilter } = useAppData();
  const { profile } = useAuth();

  const [head, setHead] = useState(() => ({
    date: report?.date ?? today(),
    site_id: report?.site_id ?? siteFilter ?? '',
    weather: report?.weather ?? '',
    reported_by: report?.reported_by ?? profile?.name ?? '',
    material_used: report?.material_used ?? '',
    issues: report?.issues ?? '',
    photos: report?.photos ?? [],
  }));
  const [tasks, setTasks] = useState(() => {
    const existing = tasksOf(report);
    if (!existing.length) return [blankTask()];
    return existing.map((t) => ({
      key: t.id,
      description: t.description ?? '',
      size_spec: t.size_spec ?? '',
      area: t.area ?? '',
      qty: t.qty === null || t.qty === undefined ? '' : String(t.qty),
      unit: t.unit ?? '',
      remarks: t.remarks ?? '',
      crew: Object.fromEntries(crewOf(t).map((m) => [m.employee_id, m.hours === null || m.hours === undefined ? '' : String(m.hours)])),
    }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const areas = useMemo(
    () => siteAreas(head.site_id).map((a) => a.name),
    [siteAreas, head.site_id]
  );

  // Workers on this site, plus anyone not tied to a site at all.
  const crewOptions = useMemo(() => {
    if (!head.site_id) return activeEmployees;
    return activeEmployees.filter((e) => e.site_id === head.site_id || !e.site_id);
  }, [activeEmployees, head.site_id]);

  // Hours each worker has been given across the whole day's tasks.
  const dayHours = useMemo(() => {
    const totals = {};
    tasks.forEach((t) => {
      Object.entries(t.crew).forEach(([id, h]) => {
        totals[id] = (totals[id] ?? 0) + (Number(h) || 0);
      });
    });
    return totals;
  }, [tasks]);

  const setTask = (idx, patch) => setTasks((ts) => ts.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  function pickTaskName(idx, name) {
    const spec = specFor(name);
    setTasks((ts) => ts.map((t, i) => (i === idx
      ? { ...t, description: name, size_spec: spec || t.size_spec }
      : t)));
  }

  function toggleWorker(idx, employeeId) {
    setTasks((ts) => ts.map((t, i) => {
      if (i !== idx) return t;
      const crew = { ...t.crew };
      if (employeeId in crew) delete crew[employeeId];
      else crew[employeeId] = '';
      return { ...t, crew };
    }));
  }

  function setHours(idx, employeeId, hours) {
    setTasks((ts) => ts.map((t, i) => (i === idx ? { ...t, crew: { ...t.crew, [employeeId]: hours } } : t)));
  }

  async function save(e) {
    e.preventDefault();
    const filled = tasks.filter((t) => t.description.trim());
    if (!head.date) { setError('Pick the date.'); return; }
    if (!head.site_id) { setError('Choose the site.'); return; }
    if (!filled.length) { setError('Add at least one task.'); return; }

    const payload = {
      ...(report ? { id: report.id } : {}),
      date: head.date,
      site_id: head.site_id,
      weather: head.weather,
      material_used: head.material_used,
      issues: head.issues,
      reported_by: head.reported_by,
      work_done: report?.work_done ?? '',
      photos: head.photos,
      tasks: filled.map((t) => ({
        description: t.description.trim(),
        size_spec: t.size_spec.trim(),
        area: t.area.trim(),
        qty: t.qty === '' ? '' : String(Number(t.qty)),
        unit: t.unit,
        remarks: t.remarks.trim(),
        manpower: Object.entries(t.crew).map(([employee_id, hours]) => ({
          employee_id,
          hours: hours === '' ? null : Number(hours),
        })),
      })),
    };

    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc('save_dpr', { p: payload });
      if (err) throw new Error(friendly(err));
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const overWorked = Object.entries(dayHours).filter(([, h]) => h > 24);

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
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

      <div>
        <SubHeading className="mb-2" action={(
          <span className="text-[11px] font-normal" style={{ color: THEME.textDim }}>
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </span>
        )}>TASKS</SubHeading>

        <div className="space-y-3">
          {tasks.map((t, idx) => (
            <div key={t.key} className="p-3 rounded-lg" style={{ background: THEME.panel2 }}>
              <div className="flex justify-end">
                <IconBtn
                  icon={Trash2}
                  title="Remove task"
                  onClick={() => setTasks((ts) => (ts.length === 1 ? [blankTask()] : ts.filter((_, i) => i !== idx)))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Task" required full>
                  <Input
                    list="dpr-task-list"
                    required
                    placeholder="Pick from the list, or type the work"
                    value={t.description}
                    onChange={(e) => pickTaskName(idx, e.target.value)}
                  />
                </Field>
                <Field label="Size / specification">
                  <Input placeholder="e.g. 100 mm" value={t.size_spec}
                    onChange={(e) => setTask(idx, { size_spec: e.target.value })} />
                </Field>
                <Field
                  label="Location"
                  hint={areas.length
                    ? 'Pick an area or type one. Admin maintains the list in Admin Control.'
                    : 'Type where in the site. Admin can add this site’s areas in Admin Control.'}
                >
                  <Input list={`dpr-area-list-${head.site_id || 'none'}`} placeholder="e.g. Basement 1 — Pump room"
                    value={t.area} onChange={(e) => setTask(idx, { area: e.target.value })} />
                </Field>
                <Field label="Quantity">
                  <Input type="number" min="0" step="any" inputMode="decimal" placeholder="Qty"
                    value={t.qty} onChange={(e) => setTask(idx, { qty: e.target.value })} />
                </Field>
                <Field label="Unit">
                  <Select placeholder="Unit…" options={UNITS.map((u) => ({ value: u.value, label: u.value }))}
                    value={t.unit} onChange={(e) => setTask(idx, { unit: e.target.value })} />
                </Field>
                <Field label="Remarks" full>
                  <Input placeholder="Anything worth noting about this task"
                    value={t.remarks} onChange={(e) => setTask(idx, { remarks: e.target.value })} />
                </Field>
              </div>

              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide mb-1.5" style={{ color: THEME.textDim }}>
                  Manpower deployed
                </div>
                {crewOptions.length === 0 ? (
                  <div className="text-xs" style={{ color: THEME.textDim }}>
                    No workers on the roll for this site yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {crewOptions.map((emp) => {
                      const on = emp.id in t.crew;
                      const total = dayHours[emp.id] ?? 0;
                      return (
                        <div key={emp.id} className="flex items-center gap-2">
                          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0"
                              style={{ accentColor: MODULE.accent }}
                              checked={on}
                              onChange={() => toggleWorker(idx, emp.id)}
                            />
                            <span className="truncate">
                              {emp.name}
                              {emp.trade && <span className="text-[11px] ml-1" style={{ color: THEME.textDim }}>{emp.trade}</span>}
                            </span>
                          </label>
                          {on && (
                            <>
                              <Input
                                type="number" min="0" max="24" step="0.5" inputMode="decimal" placeholder="Hrs"
                                aria-label={`Hours for ${emp.name}`}
                                style={{ width: 74, padding: '0.35rem 0.5rem' }}
                                value={t.crew[emp.id]}
                                onChange={(e) => setHours(idx, emp.id, e.target.value)}
                              />
                              <span className="text-[11px] whitespace-nowrap" style={{ color: total > 24 ? THEME.amber : THEME.textDim }}>
                                {total} h today
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={() => setTasks((ts) => [...ts, blankTask()])}
          className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color: MODULE.accent }}>
          <Plus size={14} /> Add task
        </button>

        <datalist id="dpr-task-list">
          {DPR_TASK_NAMES.map((n) => <option key={n} value={n} />)}
        </datalist>
        <datalist id={`dpr-area-list-${head.site_id || 'none'}`}>
          {areas.map((a) => <option key={a} value={a} />)}
        </datalist>
      </div>

      {overWorked.length > 0 && (
        <Banner tone="amber">
          More than 24 hours in one day for {overWorked.map(([id, h]) => `${crewOptions.find((e) => e.id === id)?.name ?? 'a worker'} (${h} h)`).join(', ')}.
          Check the hours — it will still save.
        </Banner>
      )}

      <Field label="Material consumed">
        <TextArea rows={2} value={head.material_used}
          onChange={(e) => setHead((h) => ({ ...h, material_used: e.target.value }))} />
      </Field>
      <Field label="Issues / delays" hint="Anything that held work up today — shortage, access, client instruction.">
        <TextArea rows={2} value={head.issues}
          onChange={(e) => setHead((h) => ({ ...h, issues: e.target.value }))} />
      </Field>
      <Field label="Photos">
        <PhotoInput value={head.photos} onChange={(v) => setHead((h) => ({ ...h, photos: v }))} folder="dpr" max={6} />
      </Field>

      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" accent={MODULE.accent} disabled={saving}>
          {saving ? 'Saving…' : report ? 'Save changes' : 'File report'}
        </Btn>
      </div>
    </form>
  );
}
