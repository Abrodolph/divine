/**
 * Document categories per scope. `expires` means the upload form asks for an
 * expiry date and the Dashboard warns 30 days ahead. Stored as documents.category.
 */
export const DOC_CATEGORIES = {
  company: [
    { key: 'fire_licence', label: 'Fire contractor licence / registration', expires: true },
    { key: 'gst', label: 'GST registration' },
    { key: 'pan', label: 'PAN' },
    { key: 'labour_licence', label: 'Labour licence (CLRA)', expires: true },
    { key: 'wc_insurance', label: 'Workmen compensation insurance', expires: true },
    { key: 'esi_pf', label: 'ESI / PF registration' },
    { key: 'bocw', label: 'BOCW registration', expires: true },
    { key: 'iso', label: 'ISO certificate', expires: true },
    { key: 'calibration', label: 'Calibration certificate (gauges, test pumps)', expires: true },
    { key: 'bank', label: 'Bank details / cancelled cheque' },
    { key: 'other', label: 'Other', expires: true },
  ],
  site: [
    { key: 'work_order', label: 'Work order / contract' },
    { key: 'boq', label: 'BOQ' },
    { key: 'gfc_drawings', label: 'GFC / shop drawing approval' },
    { key: 'hydrotest', label: 'Hydrotest / flushing / pump test report' },
    { key: 'commissioning', label: 'Commissioning report' },
    { key: 'fire_noc', label: 'Fire NOC / completion certificate', expires: true },
    { key: 'safety_approval', label: 'Client safety approval', expires: true },
    { key: 'hot_work_permit', label: 'Hot-work permit', expires: true },
    { key: 'jmr', label: 'Joint measurement record (JMR)' },
    { key: 'ra_bill', label: 'RA bill copy' },
    { key: 'other', label: 'Other', expires: true },
  ],
  employee: [
    { key: 'aadhaar', label: 'Aadhaar', numbered: true },
    { key: 'pan', label: 'PAN', numbered: true },
    { key: 'bank', label: 'Bank passbook / cancelled cheque', numbered: true },
    { key: 'police_verification', label: 'Police verification', expires: true },
    { key: 'medical', label: 'Medical fitness', expires: true },
    { key: 'induction', label: 'Safety induction' },
    { key: 'height_work', label: 'Height-work certificate', expires: true },
    { key: 'joining_form', label: 'Joining form' },
    { key: 'other', label: 'Other', expires: true },
  ],
  vendor: [
    { key: 'gst', label: 'GST certificate' },
    { key: 'cancelled_cheque', label: 'Cancelled cheque' },
    { key: 'rate_contract', label: 'Rate contract', expires: true },
    { key: 'other', label: 'Other', expires: true },
  ],
};

export const SCOPE_LABEL = { company: 'Company', site: 'Site', employee: 'Worker', vendor: 'Vendor' };

export const categoryLabel = (scope, key) => DOC_CATEGORIES[scope]?.find((c) => c.key === key)?.label ?? key;

/** Storage folder: worker documents go under 'hr', which needs hr_documents to read. */
export const docFolder = (scope) => (scope === 'employee' ? 'hr' : 'documents');
