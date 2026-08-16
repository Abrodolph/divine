import { today } from '../lib/format';

/**
 * Field + column definitions for the config-driven modules.
 * Add a field here and it appears in the form, the table, and the CSV export.
 */

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

export const REQUIREMENTS = {
  fields: [
    { key: 'date', label: 'Date', type: 'date', default: today },
    { key: 'site_id', label: 'Site', type: 'site', required: true },
    { key: 'item', label: 'What is needed', type: 'text', required: true,
      placeholder: 'e.g. 2" GI pipe, elbows, welding rods' },
    { key: 'qty', label: 'Quantity', type: 'text', placeholder: 'e.g. 30 m / 12 nos' },
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
