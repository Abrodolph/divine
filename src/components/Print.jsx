import { Printer, X } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { Btn } from './ui';

/**
 * White A4 sheet with the company letterhead, a Print / Save as PDF button,
 * and a close button. Company details come from Admin Control → Company details.
 */
export function PrintSheet({ title, docNo, date, children, onClose, footer }) {
  const { company } = useAppData();
  return (
    <div className="print-area mt-6 p-5 sm:p-8 rounded-xl bg-white text-black">
      <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-4 gap-4">
        <div className="min-w-0">
          {company.logo_url && <img src={company.logo_url} alt="" className="h-10 mb-1" />}
          <div className="text-xl sm:text-2xl font-bold" style={{ fontFamily: 'Oswald' }}>{company.name}</div>
          {company.tagline && <div className="text-xs">{company.tagline}</div>}
          {company.address && <div className="text-xs mt-1">{company.address}</div>}
          {(company.phone || company.email || company.gstin) && (
            <div className="text-xs">
              {[company.phone, company.email, company.gstin && `GSTIN ${company.gstin}`].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base sm:text-lg font-bold uppercase">{title}</div>
          {docNo && <div className="text-sm font-mono">{docNo}</div>}
          {date && <div className="text-xs mt-1">{date}</div>}
        </div>
      </div>

      {children}

      {footer ?? (
        <div className="grid grid-cols-2 gap-4 text-sm mt-12">
          <div>Prepared By: ______________________</div>
          <div>Approved By: ______________________</div>
        </div>
      )}

      <div className="no-print mt-6 flex gap-2">
        <Btn style={{ background: '#111', color: '#fff', border: '1px solid #111' }} icon={Printer} onClick={() => window.print()}>
          Print / Save as PDF
        </Btn>
        {onClose && (
          <Btn variant="ghost" icon={X} onClick={onClose} style={{ color: '#444', borderColor: '#ccc' }}>Close</Btn>
        )}
      </div>
    </div>
  );
}
