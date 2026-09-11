import { today } from '../lib/format';

/**
 * Field + column definitions for the config-driven modules.
 * Add a field here and it appears in the form, the table, and the CSV export.
 */

/** Standard unit codes (GST e-invoice UQC list) for quantity fields. */
export const UNITS = [
  { value: 'BAG', label: 'BAG — BAGS' },
  { value: 'BAL', label: 'BAL — BALE' },
  { value: 'BDL', label: 'BDL — BUNDLES' },
  { value: 'BKL', label: 'BKL — BUCKLES' },
  { value: 'BOU', label: 'BOU — BILLION OF UNITS' },
  { value: 'BOX', label: 'BOX — BOX' },
  { value: 'BTL', label: 'BTL — BOTTLES' },
  { value: 'BUN', label: 'BUN — BUNCHES' },
  { value: 'CAN', label: 'CAN — CANS' },
  { value: 'CBM', label: 'CBM — CUBIC METERS' },
  { value: 'CCM', label: 'CCM — CUBIC CENTIMETERS' },
  { value: 'CMS', label: 'CMS — CENTI METERS' },
  { value: 'CTN', label: 'CTN — CARTONS' },
  { value: 'DOZ', label: 'DOZ — DOZENS' },
  { value: 'DRM', label: 'DRM — DRUMS' },
  { value: 'GGK', label: 'GGK — GREAT GROSS' },
  { value: 'GMS', label: 'GMS — GRAMMES' },
  { value: 'GRS', label: 'GRS — GROSS' },
  { value: 'GYD', label: 'GYD — GROSS YARDS' },
  { value: 'KGS', label: 'KGS — KILOGRAMS' },
  { value: 'KLR', label: 'KLR — KILOLITRE' },
  { value: 'KME', label: 'KME — KILOMETRE' },
  { value: 'LTR', label: 'LTR — LITRES' },
  { value: 'MTR', label: 'MTR — METERS' },
  { value: 'MLT', label: 'MLT — MILILITRE' },
  { value: 'MTS', label: 'MTS — METRIC TON' },
  { value: 'NOS', label: 'NOS — NUMBERS' },
  { value: 'OTH', label: 'OTH — OTHERS' },
  { value: 'PAC', label: 'PAC — PACKS' },
  { value: 'PCS', label: 'PCS — PIECES' },
  { value: 'PRS', label: 'PRS — PAIRS' },
  { value: 'QTL', label: 'QTL — QUINTAL' },
  { value: 'ROL', label: 'ROL — ROLLS' },
  { value: 'SET', label: 'SET — SETS' },
  { value: 'SQF', label: 'SQF — SQUARE FEET' },
  { value: 'SQM', label: 'SQM — SQUARE METERS' },
  { value: 'SQY', label: 'SQY — SQUARE YARDS' },
  { value: 'TBS', label: 'TBS — TABLETS' },
  { value: 'TGM', label: 'TGM — TEN GROSS' },
  { value: 'THD', label: 'THD — THOUSANDS' },
  { value: 'TON', label: 'TON — TONNES' },
  { value: 'TUB', label: 'TUB — TUBES' },
  { value: 'UGS', label: 'UGS — US GALLONS' },
  { value: 'UNT', label: 'UNT — UNITS' },
  { value: 'YDS', label: 'YDS — YARDS' },
];

export const DPR = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site', required: true },
    { key: 'work_done', label: 'Work carried out today', type: 'textarea', full: true, required: true,
      placeholder: 'e.g. Sprinkler piping 2nd floor — 40m laid and supported' },
    { key: 'manpower', label: 'Manpower deployed', type: 'number' },
    { key: 'weather', label: 'Weather', type: 'select', options: ['Clear', 'Rain', 'Cloudy', 'Extreme Heat'] },
    { key: 'material_used', label: 'Material consumed', type: 'textarea', full: true },
    { key: 'issues', label: 'Issues / delays', type: 'textarea', full: true,
      hint: 'Anything that held work up today — shortage, access, client instruction.' },
    { key: 'reported_by', label: 'Reported by', type: 'text' },
    { key: 'photos', label: 'Photos', type: 'photos', max: 6 },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'work_done', label: 'Work Done' },
    { key: 'manpower', label: 'Manpower' },
    { key: 'issues', label: 'Issues' },
    { key: 'reported_by', label: 'By' },
    { key: 'photos', label: 'Photos', type: 'photos' },
  ],
};

/**
 * Common material catalog, from the site's requirement register
 * (public/SITE REQUIREMENT TAB.xlsx) — offered as quick-pick suggestions on
 * the requirement's "what is needed" field. Typing anything else is still
 * allowed; this is a shortlist, not a restriction.
 */
export const SITE_REQUIREMENT_ITEMS = [
  ...['300', '250', '200', '150', '100', '80', '65', '50', '40', '32', '25'].map((s) => `M.S PIPE ${s}MM`),
  ...['300', '250', '200', '150', '100', '80', '65', '50', '40', '32', '25'].map((s) => `G.I PIPE ${s}MM`),
  ...['200', '150', '100', '80', '65', '50', '40', '32', '25'].map((s) => `BUTTERFLY VALVE ${s}MM`),
  ...['200', '150', '100', '80', '65', '50', '40', '32', '25'].map((s) => `NON RETURN VALVE (NRV) ${s}MM`),
  ...['50', '40', '32', '25'].map((s) => `BALL VALVE ${s}MM`),
  ...['4', '2'].map((s) => `WRAPPING COATING ${s}MM`),
  'M.S ANGLE 40x40x5', 'M.S ANGLE 40x40x6', 'M.S ANGLE 50x50x5', 'M.S ANGLE 50x50x6', 'M.S ANGLE 75x75x6',
  'M.S CHANNEL 75x40', 'M.S CHANNEL 100x50', 'M.S CHANNEL 125x65', 'M.S CHANNEL 150x75',
];

export const REQUIREMENTS = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site', required: true },
    { key: 'item', label: 'What is needed', type: 'combo', options: SITE_REQUIREMENT_ITEMS, required: true,
      placeholder: 'Pick from the list, or type your own' },
    { key: 'qty', label: 'Quantity', type: 'number', placeholder: 'e.g. 30' },
    { key: 'unit', label: 'Unit', type: 'select', options: UNITS },
    { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium' },
    { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Fulfilled'], default: 'Open' },
    { key: 'raised_by', label: 'Raised by', type: 'text' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'item', label: 'Requirement' },
    { key: 'qty', label: 'Qty' },
    { key: 'unit', label: 'Unit' },
    { key: 'priority', label: 'Priority', type: 'status' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'raised_by', label: 'By' },
  ],
};

export const MATERIAL_RECEIVED = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site', required: true },
    { key: 'item', label: 'Material', type: 'text', required: true },
    { key: 'qty', label: 'Quantity received', type: 'text' },
    { key: 'supplier', label: 'Supplier / vendor', type: 'text' },
    { key: 'vehicle_no', label: 'Vehicle no.', type: 'text' },
    { key: 'challan_ref', label: "Supplier's DC / invoice no.", type: 'text' },
    { key: 'received_by', label: 'Received by', type: 'text' },
    { key: 'photos', label: 'Photos of material & challan', type: 'photos', max: 6,
      hint: 'Photograph the unloaded material and the supplier challan.' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'item', label: 'Material' },
    { key: 'qty', label: 'Qty' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'challan_ref', label: 'DC / Invoice' },
    { key: 'photos', label: 'Photos', type: 'photos' },
  ],
};

export const TRANSPORT = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'vehicle_no', label: 'Vehicle no.', type: 'text', required: true, placeholder: 'MH 12 AB 1234' },
    { key: 'transporter_name', label: 'Transporter', type: 'text' },
    { key: 'driver_name', label: 'Driver name', type: 'text' },
    { key: 'driver_phone', label: 'Driver phone', type: 'tel' },
    { key: 'from_loc', label: 'From', type: 'text' },
    { key: 'site_id', label: 'To (site)', type: 'site' },
    { key: 'purpose', label: 'Purpose', type: 'select',
      options: ['Material Delivery', 'Material Return', 'Tools', 'Personnel', 'Other'] },
    { key: 'lr_no', label: 'LR / docket no.', type: 'text' },
    { key: 'freight', label: 'Freight (₹)', type: 'number' },
    { key: 'photos', label: 'Photos', type: 'photos', max: 4 },
    { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'vehicle_no', label: 'Vehicle' },
    { key: 'driver_name', label: 'Driver' },
    { key: 'driver_phone', label: 'Phone' },
    { key: 'from_loc', label: 'From' },
    { key: 'site_id', label: 'To', type: 'site' },
    { key: 'purpose', label: 'Purpose' },
    { key: 'lr_no', label: 'LR No.' },
  ],
};

export const MTC = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'material', label: 'Material', type: 'text', required: true,
      placeholder: 'e.g. MS pipe heavy class, 100mm' },
    { key: 'supplier', label: 'Supplier / manufacturer', type: 'text' },
    { key: 'batch_no', label: 'Batch / heat no.', type: 'text' },
    { key: 'cert_no', label: 'Certificate no.', type: 'text' },
    { key: 'test_date', label: 'Test date', type: 'date' },
    { key: 'result', label: 'Result', type: 'select', options: ['Pass', 'Fail', 'Pending'], default: 'Pending' },
    { key: 'photos', label: 'Certificate photos', type: 'photos', max: 6,
      hint: 'Photograph every page of the certificate.' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'material', label: 'Material' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'batch_no', label: 'Batch' },
    { key: 'cert_no', label: 'Cert No.' },
    { key: 'result', label: 'Result', type: 'status' },
    { key: 'photos', label: 'Certificate', type: 'photos' },
  ],
};

export const DRAWINGS = {
  fields: [
    { key: 'date', label: 'Date received', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'drawing_no', label: 'Drawing no.', type: 'text', required: true },
    { key: 'title', label: 'Drawing title', type: 'text', required: true },
    { key: 'discipline', label: 'Discipline', type: 'select',
      options: ['Fire Fighting', 'Fire Alarm', 'Electrical', 'Plumbing', 'HVAC', 'Civil'] },
    { key: 'revision', label: 'Revision', type: 'text', placeholder: 'R0 / R1 / R2' },
    { key: 'status', label: 'Status', type: 'select',
      options: ['For Review', 'Approved', 'For Construction', 'Superseded'], default: 'For Review' },
    { key: 'received_from', label: 'Received from', type: 'text', placeholder: 'Consultant / client / architect' },
    { key: 'photos', label: 'Drawing photos', type: 'photos', max: 6 },
    { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'drawing_no', label: 'Drawing No.' },
    { key: 'title', label: 'Title' },
    { key: 'discipline', label: 'Discipline' },
    { key: 'revision', label: 'Rev' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'site_id', label: 'Site', type: 'site' },
  ],
};

export const REWORK = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site', required: true },
    { key: 'area', label: 'Area / location', type: 'text' },
    { key: 'issue', label: 'Issue identified', type: 'textarea', full: true, required: true },
    { key: 'cause', label: 'Root cause', type: 'textarea', full: true },
    { key: 'action', label: 'Corrective action', type: 'textarea', full: true },
    { key: 'responsible', label: 'Responsible person', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['Open', 'In Progress', 'Closed'], default: 'Open' },
    { key: 'photos', label: 'Photos', type: 'photos', max: 6 },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'area', label: 'Area' },
    { key: 'issue', label: 'Issue' },
    { key: 'responsible', label: 'Responsible' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'photos', label: 'Photos', type: 'photos' },
  ],
};
