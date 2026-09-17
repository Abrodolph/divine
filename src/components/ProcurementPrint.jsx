import { fmtDate, inr } from '../lib/format';
import { lineTotals } from '../lib/procurement';
import { useAppData } from '../context/AppDataContext';
import { PrintSheet } from './Print';

/** Purchase order on A4 with GST break-up, vendor and delivery details. */
export function PurchaseOrderPrint({ po, vendor, requestDocNo, onClose }) {
  const { siteName, sites, company } = useAppData();
  const site = sites.find((s) => s.id === po.deliver_to_site_id);
  const t = lineTotals(po.items ?? []);
  return (
    <PrintSheet title="Purchase Order" docNo={po.doc_no} date={`Date: ${fmtDate(po.date)}`} onClose={onClose}
      footer={(
        <div className="grid grid-cols-2 gap-4 text-sm mt-12">
          <div>Vendor acceptance: ______________________</div>
          <div className="text-right">For {company.name}<br /><br />Authorised signatory</div>
        </div>
      )}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <div className="font-bold">To</div>
          <div>{vendor?.name ?? '—'}</div>
          {vendor?.address && <div className="whitespace-pre-line">{vendor.address}</div>}
          {vendor?.gstin && <div>GSTIN {vendor.gstin}</div>}
          {(vendor?.contact_name || vendor?.phone) && <div>{[vendor.contact_name, vendor.phone].filter(Boolean).join(' · ')}</div>}
        </div>
        <div>
          <div className="font-bold">Deliver to</div>
          <div>{siteName(po.deliver_to_site_id)}</div>
          {site?.location && <div>{site.location}</div>}
          {site?.contact && <div>Site contact: {site.contact}</div>}
          {requestDocNo && <div className="mt-1">Against request {requestDocNo}</div>}
        </div>
      </div>

      <table className="w-full text-sm border-collapse mb-3">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-1 w-8">#</th>
            <th className="text-left py-1">Description</th>
            <th className="text-right py-1">Qty</th>
            <th className="text-left py-1 pl-2">Unit</th>
            <th className="text-right py-1">Rate</th>
            <th className="text-right py-1">Amount</th>
            <th className="text-right py-1">GST</th>
          </tr>
        </thead>
        <tbody>
          {(po.items ?? []).map((l, i) => {
            const amount = Number(l.qty) * Number(l.price);
            return (
              <tr key={i} className="border-b border-gray-300">
                <td className="py-1">{i + 1}</td>
                <td className="py-1">{l.description}{l.size ? ` — ${l.size}` : ''}</td>
                <td className="py-1 text-right">{Number(l.qty)}</td>
                <td className="py-1 pl-2">{l.unit ?? ''}</td>
                <td className="py-1 text-right">{inr(l.price)}</td>
                <td className="py-1 text-right">{inr(amount)}</td>
                <td className="py-1 text-right">{Number(l.gst_pct) || 0}% · {inr((amount * (Number(l.gst_pct) || 0)) / 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end text-sm mb-4">
        <table>
          <tbody>
            <tr><td className="pr-6">Subtotal</td><td className="text-right">{inr(t.subtotal)}</td></tr>
            <tr><td className="pr-6">GST</td><td className="text-right">{inr(t.gst)}</td></tr>
            <tr className="font-bold border-t border-black"><td className="pr-6">Total</td><td className="text-right">{inr(t.total)}</td></tr>
          </tbody>
        </table>
      </div>
      {po.terms && <div className="text-sm whitespace-pre-line"><b>Terms:</b> {po.terms}</div>}
    </PrintSheet>
  );
}
