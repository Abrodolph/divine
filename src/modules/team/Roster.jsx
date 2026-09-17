import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, UserMinus } from 'lucide-react';
import { THEME } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { fmtDate, inr, today } from '../../lib/format';
import { useRecords, friendly } from '../../hooks/useRecords';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import { moduleByKey } from '../../config/modules';
import DocumentsPanel from '../../components/DocumentsPanel';
import { AuditButton } from '../../components/AuditTrail';
import {
  EmptyState, Loading, Card, Btn, Field, Input, Select, SiteSelect, TableWrap, Th, Td, IconBtn, DeleteBtn,
  ExportButton, Modal, PhotoInput, StoredImage, Toggle, FormError, SubHeading,
} from '../../components/ui';

const MODULE = moduleByKey('team');
const blankWorker = {
  name: '', trade: '', site_id: '', wage_type: 'Daily', wage_rate: '', effective_from: today(),
  phone: '', aadhaar: '', consent: false, photo: '',
};

const fmtAadhaar = (n) => {
  const d = String(n).replace(/\D/g, '');
  return d.length === 12 ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : String(n);
};

/** The worker list: people on the roll, or (archived) people who have left. */
export default function Roster({ editable, archived = false }) {
  const { activeSites, siteName } = useAppData();
  const { canView, canEdit } = useAuth();
  const hrView = canView('hr_documents');
  const hrEdit = canEdit('hr_documents');
  const { rows: allEmployees, loading, add, update, remove, reload } = useRecords('employees', { orderBy: 'name', ascending: true, pageSize: 2000 });
  const employees = useMemo(
    () => allEmployees.filter((e) => (archived ? e.active === false : e.active !== false)),
    [allEmployees, archived]
  );
  const { rows: aadhaarDocs, reload: reloadAadhaar } = useRecords('documents', {
    select: 'id,scope_id,number,created_at',
    filters: [['scope', 'eq', 'employee'], ['category', 'eq', 'aadhaar']],
    orderBy: 'created_at', pageSize: 5000, enabled: hrView,
  });
  // Newest Aadhaar document per worker (rows arrive newest first).
  const aadhaarOf = useMemo(() => {
    const m = {};
    aadhaarDocs.forEach((d) => { if (d.number && !m[d.scope_id]) m[d.scope_id] = d.number; });
    return m;
  }, [aadhaarDocs]);
  const aadhaarText = (e) => (aadhaarOf[e.id] ? fmtAadhaar(aadhaarOf[e.id]) : e.aadhaar_last4 ? `••••${e.aadhaar_last4}` : '');

  const [leaving, setLeaving] = useState(null); // employee being marked as left
  const [editing, setEditing] = useState(null); // null | 'new' | employee
  const [form, setForm] = useState(blankWorker);
  const [aadhaarDoc, setAadhaarDoc] = useState(null);
  const [rates, setRates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!editing || editing === 'new') { setRates([]); setAadhaarDoc(null); return; }
    let alive = true;
    (async () => {
      const [r, d] = await Promise.all([
        supabase.from('employee_rates').select('*').eq('employee_id', editing.id).order('effective_from', { ascending: false }),
        hrView
          ? supabase.from('documents').select('id,number').eq('scope', 'employee').eq('scope_id', editing.id).eq('category', 'aadhaar')
            .order('created_at', { ascending: false }).limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      if (!alive) return;
      setRates(r.data ?? []);
      const doc = d.data?.[0] ?? null;
      setAadhaarDoc(doc);
      if (doc?.number) setForm((f) => ({ ...f, aadhaar: doc.number }));
    })();
    return () => { alive = false; };
  }, [editing, hrView]);

  function open(emp) {
    setEditing(emp ?? 'new');
    setForm(emp ? {
      name: emp.name ?? '', trade: emp.trade ?? '', site_id: emp.site_id ?? '',
      wage_type: emp.wage_type ?? 'Daily', wage_rate: emp.wage_rate != null ? String(emp.wage_rate) : '', effective_from: today(),
      phone: emp.phone ?? '', aadhaar: '', consent: !!emp.consent_at, photo: emp.photo ?? '',
    } : blankWorker);
    setError(null);
  }

  async function saveAadhaar(employeeId) {
    const number = form.aadhaar.replace(/\s/g, '');
    if (!hrEdit || number === (aadhaarDoc?.number ?? '').replace(/\s/g, '')) return;
    if (number && !/^\d{12}$/.test(number)) throw new Error('Aadhaar must be 12 digits.');
    const res = aadhaarDoc
      ? number
        ? await supabase.from('documents').update({ number, updated_at: new Date().toISOString() }).eq('id', aadhaarDoc.id)
        : await supabase.from('documents').delete().eq('id', aadhaarDoc.id)
      : number
        ? await supabase.from('documents').insert({ scope: 'employee', scope_id: employeeId, category: 'aadhaar', title: 'Aadhaar', number })
        : { error: null };
    if (res.error) throw new Error(friendly(res.error));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const base = {
      name: form.name.trim(), trade: form.trade || null, site_id: form.site_id || null, phone: form.phone || null,
      photo: form.photo || null,
      consent_at: form.consent ? (editing !== 'new' && editing.consent_at ? editing.consent_at : new Date().toISOString()) : null,
    };
    try {
      if (form.aadhaar && !/^\d{12}$/.test(form.aadhaar.replace(/\s/g, ''))) throw new Error('Aadhaar must be 12 digits.');
      if (editing === 'new') {
        const emp = await add({ ...base, wage_type: form.wage_type, wage_rate: Number(form.wage_rate) || 0 });
        await saveAadhaar(emp.id);
        reload();
      } else {
        await update(editing.id, base);
        const wageChanged = form.wage_type !== editing.wage_type || Number(form.wage_rate) !== Number(editing.wage_rate);
        if (wageChanged) {
          // A new rate row; the database mirrors today's rate onto the worker.
          const { error: err } = await supabase.from('employee_rates').upsert({
            employee_id: editing.id, effective_from: form.effective_from || today(),
            wage_type: form.wage_type, rate: Number(form.wage_rate) || 0,
          }, { onConflict: 'employee_id,effective_from' });
          if (err) throw new Error(friendly(err));
        }
        await saveAadhaar(editing.id);
        reload();
      }
      reloadAadhaar();
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRate(rate) {
    const { error: err } = await supabase.from('employee_rates').delete().eq('id', rate.id);
    if (err) setError(friendly(err));
    else { setRates((r) => r.filter((x) => x.id !== rate.id)); reload(); }
  }

  const wageChanged = editing && editing !== 'new'
    && (form.wage_type !== editing.wage_type || Number(form.wage_rate) !== Number(editing.wage_rate));

  const exportCols = [
    { key: 'name', label: 'Name' },
    { key: 'trade', label: 'Trade' },
    { key: 'site_id', label: 'Site', value: (r) => siteName(r.site_id) },
    { key: 'wage_type', label: 'Wage Type' },
    { key: 'wage_rate', label: 'Rate' },
    { key: 'phone', label: 'Phone' },
    ...(hrView ? [{ key: 'aadhaar', label: 'Aadhaar', value: aadhaarText }] : []),
    ...(archived ? [{ key: 'left_on', label: 'Left on', value: (r) => (r.left_on ? fmtDate(r.left_on) : '') }] : []),
  ];
  const actions = { editable, update, remove, setError, onOpen: open, onLeave: setLeaving };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5">
        {editable && !archived && <Btn accent={MODULE.accent} icon={Plus} onClick={() => open(null)} className="w-full sm:w-auto">Add Worker</Btn>}
        <ExportButton filename={archived ? 'team_archive.csv' : 'team.csv'} columns={exportCols} rows={employees} />
      </div>

      {!editing && error && <div className="text-xs mb-3" style={{ color: THEME.red }}>{error}</div>}

      {loading ? <Loading /> : employees.length === 0 ? (
        <Card>
          {archived
            ? <EmptyState label="Nobody has left yet." hint='Workers marked "Left" on the Team page are listed here.' />
            : <EmptyState label="No workers on the roll." hint="Add your team so attendance and payroll can work." />}
        </Card>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {employees.map((e) => (
              <Card key={e.id} className="p-3 flex justify-between items-start gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {e.photo && <StoredImage src={e.photo} className="rounded-lg object-cover shrink-0" style={{ height: 44, width: 44 }} />}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                      {[e.trade, e.site_id ? siteName(e.site_id) : 'Floating'].filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs mt-0.5">
                      {inr(e.wage_rate)}{e.wage_type === 'Daily' ? '/day' : '/month'}
                      {e.phone && <span style={{ color: THEME.textDim }}> · {e.phone}</span>}
                    </div>
                    {hrView && aadhaarText(e) && <div className="text-xs mt-0.5 font-mono" style={{ color: THEME.textDim }}>Aadhaar {aadhaarText(e)}</div>}
                    {archived && <div className="text-xs mt-0.5" style={{ color: THEME.amber }}>Left {e.left_on ? fmtDate(e.left_on) : '(date not recorded)'}</div>}
                  </div>
                </div>
                <RowActions emp={e} {...actions} />
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr style={{ background: THEME.panel2 }}>
                  {['', 'Name', 'Trade', 'Site', 'Wage', 'Phone', ...(hrView ? ['Aadhaar'] : []), ...(archived ? ['Left on'] : [])].map((h) => <Th key={h}>{h}</Th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-t" style={{ borderColor: THEME.border }}>
                    <Td>{e.photo ? <StoredImage src={e.photo} className="rounded object-cover" style={{ height: 32, width: 32 }} /> : null}</Td>
                    <Td><span className="font-medium">{e.name}</span></Td>
                    <Td>{e.trade || '—'}</Td>
                    <Td>{e.site_id ? siteName(e.site_id) : <span style={{ color: THEME.textDim }}>Floating</span>}</Td>
                    <Td>{inr(e.wage_rate)}{e.wage_type === 'Daily' ? '/day' : '/mo'}</Td>
                    <Td>{e.phone || '—'}</Td>
                    {hrView && <Td><span className="font-mono whitespace-nowrap">{aadhaarText(e) || '—'}</span></Td>}
                    {archived && <Td>{e.left_on ? fmtDate(e.left_on) : <span style={{ color: THEME.textDim }}>Not recorded</span>}</Td>}
                    <Td><RowActions emp={e} {...actions} /></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} wide accent={MODULE.accent}
        title={editing === 'new' ? 'Add worker' : editing?.name ?? ''}>
        {editing && (
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <fieldset disabled={!editable} className="contents">
              <Field label="Name" required><Input required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Trade"><Input value={form.trade} onChange={(e) => set('trade', e.target.value)} placeholder="Fitter, Welder, Electrician, Helper…" /></Field>
              <Field label="Primary site" hint="Leave blank if they move between sites.">
                <SiteSelect sites={activeSites} placeholder="Floating (no fixed site)" value={form.site_id} onChange={(e) => set('site_id', e.target.value)} />
              </Field>
              <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field label="Wage type">
                <Select placeholder={null} value={form.wage_type} options={['Daily', 'Monthly']} onChange={(e) => set('wage_type', e.target.value)} />
              </Field>
              <Field label={form.wage_type === 'Monthly' ? 'Monthly wage (₹)' : 'Daily wage (₹)'}>
                <Input type="number" min="0" inputMode="numeric" value={form.wage_rate} onChange={(e) => set('wage_rate', e.target.value)} />
              </Field>
              {wageChanged && (
                <Field label="New wage effective from" required full hint="Days before this date are still paid at the old rate.">
                  <Input type="date" required value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
                </Field>
              )}
              {hrEdit && (
                <Field label="Aadhaar number" hint="Stored in the restricted documents vault. Others see only the last 4 digits.">
                  <Input value={form.aadhaar} inputMode="numeric" maxLength={14} placeholder="12-digit number"
                    onChange={(e) => set('aadhaar', e.target.value.replace(/[^\d ]/g, ''))} />
                </Field>
              )}
              <Field label="Passport size photo" full>
                <PhotoInput value={form.photo ? [form.photo] : []} onChange={(v) => set('photo', v[0] ?? '')} folder="team" private max={1} label="Add photo" />
              </Field>
              <div className="sm:col-span-2">
                <Toggle checked={form.consent} onChange={(v) => set('consent', v)}
                  label="Worker agreed to their photo and ID being stored"
                  hint="Tick after explaining it to them. Recorded with today's date." />
              </div>
            </fieldset>
            <FormError error={error} />
            {editable && (
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Btn type="button" variant="subtle" onClick={() => setEditing(null)}>Cancel</Btn>
                <Btn type="submit" accent={MODULE.accent} disabled={saving}>{saving ? 'Saving…' : 'Save worker'}</Btn>
              </div>
            )}

            {editing !== 'new' && (
              <>
                <div className="sm:col-span-2">
                  <SubHeading className="mt-2 mb-2">WAGE HISTORY</SubHeading>
                  {rates.length === 0 ? <div className="text-xs" style={{ color: THEME.textDim }}>No history yet.</div> : (
                    <ul className="text-sm space-y-1">
                      {rates.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg" style={{ background: THEME.panel2 }}>
                          <span>
                            {inr(r.rate)} {r.wage_type === 'Daily' ? '/ day' : '/ month'}
                            <span className="text-xs ml-2" style={{ color: THEME.textDim }}>
                              from {r.effective_from <= '2000-01-01' ? 'the start' : fmtDate(r.effective_from)}
                            </span>
                          </span>
                          {editable && rates.length > 1 && <DeleteBtn onDelete={() => deleteRate(r)} label="this rate" />}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {hrView && (
                  <div className="sm:col-span-2">
                    <SubHeading className="mt-2 mb-2">WORKER DOCUMENTS</SubHeading>
                    <DocumentsPanel scope="employee" scopeId={editing.id} compact />
                  </div>
                )}
              </>
            )}
          </form>
        )}
      </Modal>

      <Modal open={!!leaving} onClose={() => setLeaving(null)} title={`${leaving?.name ?? ''} is leaving`} accent={THEME.amber}>
        {leaving && <LeaveForm emp={leaving} update={update} onDone={() => setLeaving(null)} />}
      </Modal>
    </div>
  );
}

function LeaveForm({ emp, update, onDone }) {
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (!date) { setError('Pick the day they left.'); return; }
    setSaving(true);
    setError(null);
    try {
      await update(emp.id, { active: false, left_on: date });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <Field label="Last day with the company" required hint="They move to the Team Archive. Payroll still pays them up to this day.">
        <Input type="date" required autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="subtle" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" accent={THEME.amber} icon={UserMinus} disabled={saving}>{saving ? 'Saving…' : 'Mark as left'}</Btn>
      </div>
    </form>
  );
}

function RowActions({ emp, editable, update, remove, setError, onOpen, onLeave }) {
  const left = emp.active === false;
  return (
    <div className="flex items-center justify-end gap-1 shrink-0">
      <AuditButton table="employees" rowId={emp.id} />
      <IconBtn icon={Pencil} title={editable ? 'Edit details' : 'Open'} onClick={() => onOpen(emp)} />
      {editable && (
        <>
          <Btn variant="ghost" className="!px-2 !py-1 !text-xs"
            onClick={() => (left
              ? update(emp.id, { active: true, left_on: null }).catch((e) => setError(e.message))
              : onLeave(emp))}>
            {left ? 'Rehire' : 'Left'}
          </Btn>
          <DeleteBtn onDelete={() => remove(emp.id).catch((e) => setError(e.message))} label="this worker" />
        </>
      )}
    </div>
  );
}
