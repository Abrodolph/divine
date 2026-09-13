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
 * Material catalog for Site Requirements, from public/SITE REQUIREMENT TAB.xlsx
 * ("SITE REQUIREMENT" and "CONSUMABLES" sheets). One entry per item — the size
 * is picked separately in the Dimension field, so "M.S PIPE" is listed once
 * rather than once per diameter.
 *
 *   unit   default unit, pre-filled when the item is picked (still changeable)
 *   sizes  item needs a dimension, picked from this list (compulsory)
 *   size   item needs a dimension that has no fixed list — typed in
 *          (compulsory); the value is the placeholder
 *   (neither) no dimension applies, so the field is hidden
 */
const mm = (list) => list.map((s) => `${s}MM`);
const inch = (list) => list.map((s) => `${s} INCH`);
const PIPE_MM = mm(['25', '32', '40', '50', '65', '80', '100', '150', '200', '250', '300']);
const VALVE_MM = mm(['25', '32', '40', '50', '65', '80', '100', '150', '200']);
const BSP = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '4"', '5"', '6"'];

export const REQUIREMENT_CATALOG = [
  {
    group: 'Pipes, valves & steel',
    items: [
      { name: 'M.S PIPE', unit: 'MTR', sizes: PIPE_MM },
      { name: 'G.I PIPE', unit: 'MTR', sizes: PIPE_MM },
      { name: 'BUTTERFLY VALVE', unit: 'NOS', sizes: VALVE_MM },
      { name: 'NON RETURN VALVE (NRV)', unit: 'NOS', sizes: VALVE_MM },
      { name: 'BALL VALVE', unit: 'NOS', sizes: mm(['25', '32', '40', '50']) },
      { name: 'WRAPPING COATING', unit: 'MTR', sizes: mm(['2', '4']) },
      { name: 'M.S ANGLE', unit: 'MTR', sizes: ['40x40x5', '40x40x6', '50x50x5', '50x50x6', '75x75x6'] },
      { name: 'M.S CHANNEL', unit: 'MTR', sizes: ['75x40', '100x50', '125x65', '150x75'] },
    ],
  },
  {
    group: 'Consumables',
    items: [
      { name: 'WELDING ROD', unit: 'KGS', sizes: mm(['2.5', '3.15', '4.0']) },
      { name: 'CUTTING WHEEL', unit: 'NOS', sizes: inch(['4', '5', '7']) },
      { name: 'GRINDING WHEEL', unit: 'NOS', sizes: inch(['4', '5', '7']) },
      { name: 'MACHINE OIL', unit: 'NOS', sizes: ['1 LTR', '5 LTR', '20 LTR'] },
      { name: 'NUT BOLT', unit: 'NOS', sizes: ['M6', 'M8', 'M10', 'M12', 'M16'] },
      { name: 'BULLET FASTENER', unit: 'NOS', sizes: ['M8', 'M10', 'M12'] },
      { name: 'ANCHOR FASTENER', unit: 'NOS', sizes: ['M8', 'M10', 'M12', 'M16'] },
      { name: 'PAINT', unit: 'NOS', sizes: ['4 KG', '8 KG', '10 KG'] },
      { name: 'PRIMER', unit: 'NOS', sizes: ['4 KG', '8 KG', '10 KG'] },
      { name: 'PAINT BRUSH', unit: 'NOS', sizes: inch(['1', '2', '3', '4']) },
      { name: 'TEFLON TAPE', unit: 'ROL', sizes: mm(['12', '19', '25']) },
      { name: 'THREAD SEALANT', unit: 'NOS', sizes: ['50 GM', '100 GM', '250 GM'] },
      { name: 'PTFE SEALANT', unit: 'NOS', sizes: ['100 GM', '250 GM'] },
      { name: 'GI PIPE JOINTING COMPOUND', unit: 'NOS', sizes: ['1 KG', '5 KG'] },
      { name: 'GASKET', unit: 'NOS', sizes: BSP },
      { name: 'RUBBER SHEET', unit: 'SQM', sizes: mm(['2', '3', '5']) },
      { name: 'GI/MS PIPE', unit: 'MTR', size: 'e.g. 25MM GI' },
      { name: 'PIPE NIPPLES', unit: 'NOS', sizes: ['1/2"', '3/4"', '1"', '1-1/2"'] },
      { name: 'GI FITTINGS', unit: 'NOS', sizes: BSP.slice(0, 9) },
      { name: 'MS FLANGES', unit: 'NOS', size: 'e.g. 100MM' },
      { name: 'U-CLAMP / PIPE CLAMP', unit: 'NOS', sizes: mm(['25', '32', '40', '50', '65', '80']) },
      { name: 'CLEVIS HANGER', unit: 'NOS', size: 'e.g. for 50MM pipe' },
      { name: 'THREADED ROD', unit: 'NOS', sizes: mm(['6', '8', '10', '12']) },
      { name: 'GI CHANNEL / STRUT', unit: 'MTR', sizes: ['41x41'] },
      { name: 'PVC INSULATION TAPE', unit: 'ROL', sizes: ['18MM'] },
      { name: 'CABLE TIES', unit: 'PAC', sizes: mm(['100', '200', '300']) },
      { name: 'ELECTRICAL CABLE LUGS', unit: 'NOS', size: 'e.g. 2.5 SQ.MM' },
      { name: 'HEAT SHRINK SLEEVE', unit: 'MTR', size: 'e.g. 10MM' },
      { name: 'SILICONE SEALANT', unit: 'NOS', sizes: ['280 ML', '300 ML'] },
      { name: 'FIRE-RATED SEALANT', unit: 'NOS', sizes: ['300 ML', '600 ML'] },
      { name: 'FIRE STOP MATERIAL', unit: 'NOS' },
      { name: 'CABLE GLAND', unit: 'NOS', size: 'e.g. 20MM' },
      { name: 'IDENTIFICATION LABELS', unit: 'NOS' },
      { name: 'PIPE IDENTIFICATION TAPE', unit: 'ROL', sizes: ['RED', 'WHITE'] },
      { name: 'EMERY PAPER', unit: 'NOS', sizes: ['80 GRIT', '120 GRIT', '180 GRIT'] },
      { name: 'WIRE BRUSH', unit: 'NOS', sizes: inch(['1', '2', '3']) },
      { name: 'COTTON WASTE', unit: 'KGS' },
      { name: 'CLEANING SOLVENT', unit: 'NOS', sizes: ['1 LTR', '5 LTR'] },
      { name: 'ANTI-RUST PAINT', unit: 'NOS', sizes: ['1 LTR', '4 LTR', '10 LTR'] },
      { name: 'RED OXIDE PRIMER', unit: 'NOS', sizes: ['1 LTR', '4 LTR', '10 LTR'] },
    ],
  },
];

/** Picked when the item isn't in the catalog; the real name is typed into item_other. */
export const OTHER_ITEM = 'OTHER (NOT IN LIST)';

const CATALOG_BY_NAME = Object.fromEntries(
  REQUIREMENT_CATALOG.flatMap((g) => g.items).map((i) => [i.name, i])
);
export const catalogItem = (name) => CATALOG_BY_NAME[name] ?? null;
const needsDimension = (name) => {
  const c = catalogItem(name);
  return !!(c && (c.sizes || c.size));
};

export const REQUIREMENTS = {
  fields: [
    { key: 'date', label: 'Date raised', type: 'date', default: today, required: true },
    { key: 'required_by', label: 'Needed on site by (tentative)', type: 'date', required: true,
      min: (f) => f.date || undefined,
      hint: 'Best estimate — lets the office plan purchase and dispatch.' },
    { key: 'site_id', label: 'Site', type: 'site', required: true },
    { key: 'item', label: 'What is needed', type: 'select', required: true,
      options: [
        ...REQUIREMENT_CATALOG.map((g) => ({ group: g.group, options: g.items.map((i) => i.name) })),
        { group: 'Other', options: [OTHER_ITEM] },
      ],
      // A new item means the old size/unit no longer apply.
      onChange: (item) => {
        const c = catalogItem(item);
        return { item_other: '', dimension: c?.sizes?.length === 1 ? c.sizes[0] : '', unit: c?.unit ?? '' };
      } },
    { key: 'item_other', label: 'Describe the item', type: 'text', required: true,
      visible: (f) => f.item === OTHER_ITEM, placeholder: 'e.g. Sprinkler pendent 15MM 68°C' },
    { key: 'dimension', label: 'Dimension / size',
      visible: (f) => f.item === OTHER_ITEM || needsDimension(f.item),
      required: (f) => needsDimension(f.item),
      type: (f) => (catalogItem(f.item)?.sizes ? 'select' : 'text'),
      options: (f) => catalogItem(f.item)?.sizes,
      placeholder: (f) => catalogItem(f.item)?.size ?? (f.item === OTHER_ITEM ? 'If it has one' : undefined) },
    { key: 'qty', label: 'Quantity', type: 'number', required: true, min: '0.01', step: 'any', placeholder: 'e.g. 30' },
    { key: 'unit', label: 'Unit', type: 'select', options: UNITS, required: true },
    { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', required: true },
    { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Fulfilled'], default: 'Open', required: true },
    { key: 'raised_by', label: 'Raised by', type: 'text', required: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', full: true,
      placeholder: 'Class / grade (e.g. heavy class), make, delivery instructions…' },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'site_id', label: 'Site', type: 'site' },
    { key: 'item', label: 'Requirement' },
    { key: 'dimension', label: 'Size' },
    { key: 'qty', label: 'Qty' },
    { key: 'unit', label: 'Unit' },
    { key: 'required_by', label: 'Needed By', type: 'date' },
    { key: 'priority', label: 'Priority', type: 'status' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'raised_by', label: 'By' },
  ],
  /** "Other" is stored as the typed name — item_other isn't a column. */
  toRow: (row, form) => {
    const { item_other, ...rest } = row;
    if (form.item === OTHER_ITEM) rest.item = (form.item_other ?? '').trim();
    return rest;
  },
  /** Anything not in the catalog (typed "Other", or pre-catalog rows) opens as Other. */
  fromRow: (o, record) =>
    record.item && !catalogItem(record.item) ? { ...o, item: OTHER_ITEM, item_other: record.item } : o,
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
    { key: 'photos', label: 'Certificate photos / PDF', type: 'photos', max: 6, accept: 'image/*,application/pdf',
      hint: 'Photograph every page of the certificate, or attach the PDF directly.' },
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
    { key: 'cause', label: 'Root Cause' },
    { key: 'action', label: 'Corrective Action' },
    { key: 'responsible', label: 'Responsible' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'photos', label: 'Photos', type: 'photos' },
  ],
};
