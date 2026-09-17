import { useState } from 'react';
import { THEME } from '../lib/theme';
import { addDays } from '../lib/dates';
import { fmtDate, today } from '../lib/format';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { categoryLabel, SCOPE_LABEL } from '../config/documents';
import DocumentsPanel from '../components/DocumentsPanel';
import {
  SectionHeader, LockBanner, Card, EmptyState, Loading, Tabs, Select, SiteSelect, ExpiryBadge, TableWrap, Th, Td, Field,
} from '../components/ui';

const MODULE = moduleByKey('documents');

/**
 * The document vault: company licences and insurance, site approvals and
 * test reports, vendor papers, and (with Worker ID access) worker documents.
 * Files live in the private bucket; anything with an expiry date is flagged
 * 30 days ahead here and on the Dashboard.
 */
export default function Documents() {
  const { activeSites, activeEmployees, siteName, empName } = useAppData();
  const { canEdit, canView, locks } = useAuth();
  const hr = canView('hr_documents');
  const [tab, setTab] = useState('expiring');
  const [siteId, setSiteId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  const { rows: vendors } = useRecords('vendors', { orderBy: 'name', ascending: true, pageSize: 1000, enabled: canView('vendors') || canView('documents') });
  const expiring = useRecords('documents', {
    orderBy: 'expires_on', ascending: true, filters: [['expires_on', 'lte', addDays(today(), 60)]], enabled: tab === 'expiring', pageSize: 500,
  });

  const ownerName = (d) => (d.scope === 'site' ? siteName(d.scope_id)
    : d.scope === 'employee' ? empName(d.scope_id)
      : d.scope === 'vendor' ? vendors.find((v) => v.id === d.scope_id)?.name ?? 'Vendor'
        : 'Company');

  return (
    <div>
      <SectionHeader title="Documents" subtitle="Licences, insurance, approvals and certificates — with expiry warnings" icon={MODULE.icon} accent={MODULE.accent} />
      <LockBanner locked={!!locks.documents} readOnly={!canEdit('documents') && !locks.documents} />

      <Tabs value={tab} onChange={setTab} accent={MODULE.accent} tabs={[
        { value: 'expiring', label: 'Expiring soon' },
        { value: 'company', label: 'Company' },
        { value: 'site', label: 'Sites' },
        { value: 'vendor', label: 'Vendors' },
        ...(hr ? [{ value: 'employee', label: 'Workers' }] : []),
      ]} />

      {tab === 'expiring' && (
        expiring.loading ? <Loading /> : expiring.rows.length === 0 ? (
          <Card><EmptyState label="Nothing expires in the next 60 days." hint="Add expiry dates to documents so they show up here." /></Card>
        ) : (
          <TableWrap>
            <thead><tr style={{ background: THEME.panel2 }}>{['Document', 'Belongs to', 'Number', 'Expiry'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
            <tbody>
              {expiring.rows.map((d) => (
                <tr key={d.id} className="border-t" style={{ borderColor: THEME.border }}>
                  <Td>{d.title || categoryLabel(d.scope, d.category)}</Td>
                  <Td>{ownerName(d)} <span className="text-xs" style={{ color: THEME.textDim }}>{SCOPE_LABEL[d.scope]}</span></Td>
                  <Td>{d.number || '—'}</Td>
                  <Td><span className="mr-2">{fmtDate(d.expires_on)}</span><ExpiryBadge date={d.expires_on} /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )
      )}

      {tab === 'company' && <Card className="p-4"><DocumentsPanel scope="company" /></Card>}

      {tab === 'site' && (
        <Card className="p-4 space-y-4">
          <Field label="Site"><SiteSelect sites={activeSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} /></Field>
          {siteId ? <DocumentsPanel key={siteId} scope="site" scopeId={siteId} /> : <EmptyState label="Pick a site." />}
        </Card>
      )}

      {tab === 'vendor' && (
        <Card className="p-4 space-y-4">
          <Field label="Vendor">
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
          </Field>
          {vendorId ? <DocumentsPanel key={vendorId} scope="vendor" scopeId={vendorId} /> : <EmptyState label="Pick a vendor." />}
        </Card>
      )}

      {tab === 'employee' && hr && (
        <Card className="p-4 space-y-4">
          <Field label="Worker">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} options={activeEmployees.map((w) => ({ value: w.id, label: w.name }))} />
          </Field>
          {employeeId ? <DocumentsPanel key={employeeId} scope="employee" scopeId={employeeId} /> : <EmptyState label="Pick a worker." />}
        </Card>
      )}
    </div>
  );
}
