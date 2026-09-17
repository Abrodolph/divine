import { fmtDate, inr, monthLabel } from '../lib/format';
import { PrintSheet } from './Print';

/** Month salary statement with a signature column. */
export function SalarySheet({ rows, month, subtitle, onClose }) {
  const totals = rows.reduce((t, r) => ({
    gross: t.gross + r.gross, adv: t.adv + r.advances, pen: t.pen + (r.penalty || 0), net: t.net + r.net,
  }), { gross: 0, adv: 0, pen: 0, net: 0 });
  return (
    <PrintSheet title="Salary Statement" docNo={monthLabel(month)} date={subtitle} onClose={onClose}>
      <table className="w-full text-sm border-collapse mb-6">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-1">Worker</th>
            <th className="text-right py-1">Wage/day</th>
            <th className="text-right py-1">Days</th>
            <th className="text-right py-1">OT h</th>
            <th className="text-right py-1">Gross</th>
            <th className="text-right py-1">Advances</th>
            <th className="text-right py-1">Penalty</th>
            <th className="text-right py-1">Net</th>
            <th className="text-left py-1 pl-4">Signature</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_id} className="border-b border-gray-300">
              <td className="py-1.5">{r.name}</td>
              <td className="py-1.5 text-right">{inr(r.day_rate)}</td>
              <td className="py-1.5 text-right">{r.paid_days}</td>
              <td className="py-1.5 text-right">{r.ot_hours || '—'}</td>
              <td className="py-1.5 text-right">{inr(r.gross)}</td>
              <td className="py-1.5 text-right">{r.advances ? `-${inr(r.advances)}` : '—'}</td>
              <td className="py-1.5 text-right">{r.penalty ? `-${inr(r.penalty)}` : '—'}</td>
              <td className="py-1.5 text-right font-semibold">{inr(r.net)}</td>
              <td className="py-1.5 pl-4" style={{ minWidth: 110 }} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1.5" colSpan={4}>Total</td>
            <td className="py-1.5 text-right">{inr(totals.gross)}</td>
            <td className="py-1.5 text-right">-{inr(totals.adv)}</td>
            <td className="py-1.5 text-right">-{inr(totals.pen)}</td>
            <td className="py-1.5 text-right">{inr(totals.net)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </PrintSheet>
  );
}

/** One worker's payslip — prints on A5/A4, or Save as PDF to share on WhatsApp. */
export function Payslip({ row, month, payments = [], siteName, onClose }) {
  const mine = payments.filter((p) => p.employee_id === row.employee_id && p.month === month);
  return (
    <PrintSheet title="Payslip" docNo={monthLabel(month)} date={`Generated ${fmtDate(new Date())}`} onClose={onClose}
      footer={(
        <div className="grid grid-cols-2 gap-4 text-sm mt-10">
          <div>Employer: ______________________</div>
          <div>Worker: ______________________</div>
        </div>
      )}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        <div><b>Name:</b> {row.name}</div>
        <div><b>Trade:</b> {row.trade || '—'}</div>
        <div><b>Site:</b> {siteName?.(row.site_id) ?? '—'}</div>
        <div><b>Wage per day:</b> {inr(row.day_rate)}{row.wage_type === 'Monthly' ? ` (${inr(row.rate)} / month)` : ''}</div>
        <div><b>Days present:</b> {row.paid_days}{row.half_days ? ` (incl. ${row.half_days} half)` : ''}</div>
        <div><b>Overtime:</b> {row.ot_hours ? `${row.ot_hours} h` : '—'}</div>
        <div><b>Absent / leave:</b> {row.absent} / {row.leave}</div>
        <div><b>Working days:</b> {row.working_days_elapsed} of {row.working_days}</div>
      </div>
      <table className="w-full text-sm border-collapse mb-4">
        <tbody>
          {row.breakdown.map((b, i) => (
            <tr key={i} className="border-b border-gray-300">
              <td className="py-1.5">{b.label}</td>
              <td className="py-1.5 text-right">{b.amount < 0 ? `-${inr(-b.amount)}` : inr(b.amount)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1.5">Net payable</td>
            <td className="py-1.5 text-right">{inr(row.net)}</td>
          </tr>
          {mine.map((p) => (
            <tr key={p.id} className="border-b border-gray-300">
              <td className="py-1.5">Paid {fmtDate(p.paid_on)} ({p.mode.toUpperCase()}{p.ref ? ` ${p.ref}` : ''})</td>
              <td className="py-1.5 text-right">-{inr(p.amount)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-1.5">Balance</td>
            <td className="py-1.5 text-right">{inr(row.balance)}</td>
          </tr>
        </tbody>
      </table>
    </PrintSheet>
  );
}
