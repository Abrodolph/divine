/**
 * The task catalogue offered on the Daily Progress Report, taken from the DPR
 * sheet of public/SITE REQUIREMENT TAB.xlsx.
 *
 * The dropdown is a shortcut, not a restriction: a supervisor can always type
 * a task that isn't on this list. `spec` pre-fills the size/specification box
 * when a task is picked.
 */
export const DPR_TASKS = [
  { name: 'Installation Fire Alarm Cable', spec: '2C × 1.5 / 2.5 Sq.mm' },
  { name: 'Installation Speaker Wire', spec: '2C × 1.5 / 2.5 Sq.mm' },
  { name: 'M.S. Pipe Installation', spec: '25 / 32 / 50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'G.I. Pipe Installation', spec: '25 / 32 / 50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'Elbow Installation', spec: '25 / 32 / 50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'Tee Installation', spec: '25 / 32 / 50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'Reducer Installation', spec: 'As Required' },
  { name: 'Flange Installation', spec: 'As Required' },
  { name: 'Grooved Coupling Installation', spec: 'As Required' },
  { name: 'Union Installation', spec: 'As Required' },
  { name: 'Valve Installation', spec: '25 / 32 / 50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'Butterfly Valve Installation', spec: '50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'NRV Installation', spec: '50 / 65 / 80 / 100 / 150 / 200 mm' },
  { name: 'Y-Strainer Installation', spec: 'As Required' },
  { name: 'Fire Hydrant Installation', spec: 'As Per Approved Drawing' },
  { name: 'Hose Reel Installation', spec: 'As Per Approved Drawing' },
  { name: 'Landing Valve Installation', spec: '63 mm / 2½"' },
  { name: 'Fire Hose Installation', spec: '15 / 20 / 30 m' },
  { name: 'Fire Hose Cabinet Installation', spec: 'As Per Approved Drawing' },
  { name: 'Sprinkler Installation', spec: '15 / 20 mm' },
  { name: 'Sprinkler Flexible Drop Installation', spec: 'As Required' },
  { name: 'Sprinkler Head Installation', spec: 'Upright / Pendent / Sidewall' },
  { name: 'Pipe Support Installation', spec: 'M8 / M10 / M12 Threaded Rod' },
  { name: 'Pipe Clamp Installation', spec: '25–200 mm' },
  { name: 'MS Channel Support Installation', spec: '41 × 41 / 50 × 50 mm' },
  { name: 'Fire Pump Installation', spec: 'As Per Approved Drawing' },
  { name: 'Jockey Pump Installation', spec: 'As Per Approved Drawing' },
  { name: 'Diesel Pump Installation', spec: 'As Per Approved Drawing' },
  { name: 'Fire Water Tank Connection', spec: 'As Per Approved Drawing' },
  { name: 'Pressure Gauge Installation', spec: 'As Required' },
  { name: 'Flow Switch Installation', spec: 'As Required' },
  { name: 'Pressure Switch Installation', spec: 'As Required' },
  { name: 'Test & Drain Assembly Installation', spec: 'As Required' },
  { name: 'Fire Alarm Panel Installation', spec: 'Addressable / Conventional' },
  { name: 'Smoke Detector Installation', spec: 'Addressable / Conventional' },
  { name: 'Heat Detector Installation', spec: 'Addressable / Conventional' },
  { name: 'Manual Call Point Installation', spec: 'Addressable / Conventional' },
  { name: 'Hooter / Sounder Installation', spec: 'As Required' },
  { name: 'Speaker Installation', spec: '3 / 6 / 10 W' },
  { name: 'Strobe / Sounder Strobe Installation', spec: 'As Required' },
  { name: 'Monitor Module Installation', spec: 'As Required' },
  { name: 'Control Module Installation', spec: 'As Required' },
  { name: 'Fire Alarm Junction Box Installation', spec: 'As Required' },
  { name: 'Fire Alarm Cable Termination', spec: 'As Required' },
  { name: 'Fire Alarm Cable Testing', spec: 'Continuity / Insulation' },
  { name: 'Fire Fighting Pipe Welding', spec: 'As Required' },
  { name: 'Pipe Threading / Grooving', spec: 'As Required' },
  { name: 'Pipe Flushing', spec: 'As Required' },
  { name: 'Hydrostatic Pressure Testing', spec: 'As Per Specification' },
  { name: 'Fire Fighting System Testing', spec: 'As Per Approved Procedure' },
  { name: 'Fire Alarm System Testing', spec: 'As Per Approved Procedure' },
  { name: 'Painting of Fire Fighting Pipe', spec: 'Red / As Approved' },
  { name: 'Touch-up Painting', spec: 'As Required' },
  { name: 'Fire Stopping / Sealing', spec: 'As Required' },
  { name: 'Pipe / Equipment Shifting', spec: 'As Required' },
];

export const DPR_TASK_NAMES = DPR_TASKS.map((t) => t.name);

/** The suggested specification for a task, or '' if it isn't in the catalogue. */
export const specFor = (name) => DPR_TASKS.find((t) => t.name === name)?.spec ?? '';

export const WEATHER = ['Sunny', 'Clear', 'Cloudy', 'Rain', 'Extreme Heat'];
