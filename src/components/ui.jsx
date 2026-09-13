import { useState } from 'react';
import { Download, Lock, Trash2, X, Loader2, Camera, Plus, FileText } from 'lucide-react';
import { THEME } from '../lib/theme';
import { uploadAttachment } from '../lib/upload';
import { exportCSV } from '../lib/csv';
import { fmtDate } from '../lib/format';

const isPdfUrl = (url) => /\.pdf(\?|$)/i.test(url);

/* ------------------------------- chrome ---------------------------------- */

export function HazardBar({ h = 5 }) {
  return (
    <div
      style={{
        height: h,
        background: `repeating-linear-gradient(45deg, ${THEME.amber}, ${THEME.amber} 10px, ${THEME.bg} 10px, ${THEME.bg} 20px)`,
      }}
    />
  );
}

export function SectionHeader({ title, subtitle, icon: Icon, accent = THEME.orange, action }) {
  return (
    <div className="mb-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2 shrink-0" style={{ background: `${accent}22`, color: accent }}>
            {Icon && <Icon size={20} />}
          </div>
          <div>
            <h2
              className="text-xl leading-tight"
              style={{ fontFamily: 'Oswald', letterSpacing: '0.02em', textTransform: 'uppercase' }}
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs mt-0.5" style={{ color: THEME.textDim }}>{subtitle}</p>
            )}
          </div>
        </div>
        {action && <div className="flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      <div className="mt-4" style={{ height: 1, background: THEME.border }} />
    </div>
  );
}

export function Card({ children, className = '', style = {}, ...rest }) {
  return (
    <div
      className={`rounded-xl ${className}`}
      style={{ background: THEME.panel, border: `1px solid ${THEME.border}`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function EmptyState({ label, hint }) {
  return (
    <div className="py-12 text-center px-6">
      <div className="text-sm" style={{ color: THEME.textDim }}>{label}</div>
      {hint && <div className="text-xs mt-1.5" style={{ color: THEME.textDim, opacity: 0.7 }}>{hint}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16" style={{ color: THEME.textDim }}>
      <Loader2 className="animate-spin" size={18} /> {label}
    </div>
  );
}

export function LockBanner({ locked, readOnly }) {
  if (locked) {
    return (
      <Banner tone="red" icon={Lock}>
        This section is frozen by Admin — records are view-only.
      </Banner>
    );
  }
  if (readOnly) {
    return (
      <Banner tone="dim">
        You have view-only access here. Ask Admin if you need to add entries.
      </Banner>
    );
  }
  return null;
}

export function Banner({ tone = 'amber', icon: Icon, children }) {
  const tones = {
    red: { c: THEME.red, bg: 'rgba(215,38,61,0.10)' },
    amber: { c: THEME.amber, bg: 'rgba(255,193,7,0.10)' },
    green: { c: THEME.green, bg: 'rgba(62,166,94,0.10)' },
    blue: { c: THEME.blue, bg: 'rgba(74,144,217,0.10)' },
    dim: { c: THEME.textDim, bg: 'rgba(155,161,166,0.08)' },
  };
  const t = tones[tone] ?? tones.amber;
  return (
    <div
      className="mb-4 px-3 py-2.5 rounded-lg text-xs flex items-center gap-2"
      style={{ background: t.bg, color: t.c, border: `1px solid ${t.c}44` }}
    >
      {Icon && <Icon size={14} className="shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export function StatusBadge({ value }) {
  if (!value) return <span style={{ color: THEME.textDim }}>—</span>;
  const v = String(value).toLowerCase();
  let color = THEME.textDim;
  let bg = 'rgba(155,161,166,0.15)';
  if (['open', 'pending', 'for review', 'medium', 'due'].includes(v)) {
    color = THEME.amber; bg = 'rgba(255,193,7,0.14)';
  } else if (['approved', 'fulfilled', 'closed', 'pass', 'issued', 'for construction', 'delivered', 'low', 'paid'].includes(v)) {
    color = THEME.green; bg = 'rgba(62,166,94,0.14)';
  } else if (['fail', 'urgent', 'superseded', 'high', 'rejected'].includes(v)) {
    color = THEME.red; bg = 'rgba(215,38,61,0.14)';
  } else if (['in progress', 'partial'].includes(v)) {
    color = THEME.blue; bg = 'rgba(74,144,217,0.14)';
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ color, background: bg }}>
      {value}
    </span>
  );
}

/** Salary Paid/Due badge — tap to flip it when editable. */
export function PayStatusToggle({ status = 'Due', paidOn, editable, busy, onToggle }) {
  const badge = <StatusBadge value={status} />;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {editable ? (
        <button
          type="button"
          disabled={busy}
          className="disabled:opacity-50"
          title={status === 'Paid' ? 'Mark as due' : 'Mark as paid'}
          onClick={(e) => { e.stopPropagation(); onToggle(status === 'Paid' ? 'Due' : 'Paid'); }}
        >
          {badge}
        </button>
      ) : badge}
      {status === 'Paid' && paidOn && (
        <span className="text-[11px] whitespace-nowrap" style={{ color: THEME.textDim }}>{fmtDate(paidOn)}</span>
      )}
    </span>
  );
}

/* ------------------------------- buttons --------------------------------- */

export function Btn({ children, variant = 'primary', accent = THEME.orange, icon: Icon, className = '', ...rest }) {
  const styles = {
    primary: { background: accent, color: '#111', border: `1px solid ${accent}` },
    ghost: { background: 'transparent', color: THEME.textDim, border: `1px solid ${THEME.border}` },
    danger: { background: THEME.red, color: '#fff', border: `1px solid ${THEME.red}` },
    subtle: { background: THEME.panel2, color: THEME.text, border: `1px solid ${THEME.border}` },
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${className}`}
      style={styles[variant]}
      {...rest}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function IconBtn({ icon: Icon, title, ...rest }) {
  return (
    <button
      title={title}
      aria-label={title}
      className="p-2 rounded-lg"
      style={{ color: THEME.textDim }}
      {...rest}
    >
      <Icon size={16} />
    </button>
  );
}

export function DeleteBtn({ onDelete, label = 'this entry' }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <IconBtn icon={Trash2} title={`Delete ${label}`} onClick={() => setConfirming(true)} />;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <button onClick={onDelete} className="px-2 py-1 rounded font-semibold" style={{ background: THEME.red, color: '#fff' }}>
        Delete
      </button>
      <button onClick={() => setConfirming(false)} className="px-2 py-1 rounded" style={{ color: THEME.textDim }}>
        Cancel
      </button>
    </span>
  );
}

export function ExportButton({ filename, columns, rows, label = 'Export' }) {
  return (
    <Btn variant="ghost" icon={Download} onClick={() => exportCSV(filename, columns, rows)}>
      {label}
    </Btn>
  );
}

/* -------------------------------- fields --------------------------------- */

const inputBase = 'w-full bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none';
const inputStyle = { borderColor: THEME.border, color: THEME.text };

export function Field({ label, required, hint, full, children }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
        {label}
        {required && <span style={{ color: THEME.red }}> *</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] mt-1" style={{ color: THEME.textDim }}>{hint}</div>}
    </div>
  );
}

export function Input(props) {
  return <input className={inputBase} style={inputStyle} {...props} />;
}

export function TextArea({ rows = 3, ...props }) {
  return <textarea rows={rows} className={inputBase} style={inputStyle} {...props} />;
}

export function Select({ options = [], placeholder = 'Select…', children, ...props }) {
  return (
    <select className={inputBase} style={inputStyle} {...props}>
      <option value="">{placeholder}</option>
      {children ??
        options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>{o}</option>
          ) : (
            <option key={o.value} value={o.value}>{o.label}</option>
          )
        )}
    </select>
  );
}

export function SiteSelect({ sites, ...props }) {
  return (
    <Select placeholder="Select site…" {...props}>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </Select>
  );
}

/* ------------------------------- photos ---------------------------------- */

/**
 * Camera-first photo picker. Uploads straight to Storage and hands back URLs,
 * so records only ever carry a short link.
 */
export function PhotoInput({ value = [], onChange, folder = 'misc', max = 6, label = 'Add photo', accept = 'image/*' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pdfAllowed = accept.includes('pdf');

  async function handle(e) {
    const files = [...e.target.files].slice(0, max - value.length);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const urls = [];
      for (const f of files) urls.push(await uploadAttachment(f, folder));
      onChange([...value, ...urls]);
    } catch (e2) {
      setErr(e2.message || 'Upload failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={url} className="relative">
            {isPdfUrl(url) ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col items-center justify-center rounded-lg text-[11px] gap-1"
                style={{ height: 76, width: 76, border: `1px solid ${THEME.border}`, color: THEME.textDim }}
              >
                <FileText size={22} />
                <span>PDF</span>
              </a>
            ) : (
              <img
                src={url}
                alt=""
                className="rounded-lg object-cover"
                style={{ height: 76, width: 76, border: `1px solid ${THEME.border}` }}
              />
            )}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="absolute -top-1.5 -right-1.5 rounded-full p-1"
              style={{ background: THEME.red, color: '#fff' }}
              aria-label="Remove attachment"
            >
              <X size={11} />
            </button>
          </div>
        ))}

        {value.length < max && (
          <label
            className="flex flex-col items-center justify-center rounded-lg cursor-pointer text-[11px] gap-1"
            style={{
              height: 76, width: 76,
              border: `1px dashed ${THEME.border}`,
              color: THEME.textDim,
            }}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
            <span>{busy ? 'Sending…' : label}</span>
            <input
              type="file"
              accept={accept}
              capture={pdfAllowed ? undefined : 'environment'}
              multiple
              hidden
              disabled={busy}
              onChange={handle}
            />
          </label>
        )}
      </div>
      {err && <div className="text-xs mt-2" style={{ color: THEME.red }}>{err}</div>}
    </div>
  );
}

export function PhotoStrip({ photos = [], onOpen, size = 44 }) {
  if (!photos.length) return <span style={{ color: THEME.textDim }}>—</span>;
  return (
    <div className="flex gap-1">
      {photos.slice(0, 4).map((p) => (
        isPdfUrl(p) ? (
          <a
            key={p}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="rounded flex items-center justify-center shrink-0"
            style={{ height: size, width: size, border: `1px solid ${THEME.border}`, color: THEME.textDim }}
            title="Open PDF"
          >
            <FileText size={Math.round(size * 0.45)} />
          </a>
        ) : (
          <img
            key={p}
            src={p}
            alt=""
            onClick={() => onOpen?.(p)}
            className="rounded object-cover cursor-pointer"
            style={{ height: size, width: size }}
          />
        )
      ))}
      {photos.length > 4 && (
        <span className="text-xs self-center ml-1" style={{ color: THEME.textDim }}>
          +{photos.length - 4}
        </span>
      )}
    </div>
  );
}

/** Generic centered dialog — click the backdrop or the X to close. */
export function Modal({ open, onClose, title, accent = THEME.orange, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl p-5"
        style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="text-base font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em', color: accent }}>
            {title}
          </h3>
          <button onClick={onClose} className="p-1 rounded shrink-0" style={{ color: THEME.textDim }} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.9)' }}
      onClick={onClose}
    >
      <img src={src} alt="" style={{ maxHeight: '90vh', maxWidth: '95vw', borderRadius: 8 }} />
      <button className="absolute top-4 right-4 p-2" style={{ color: '#fff' }} onClick={onClose} aria-label="Close">
        <X size={26} />
      </button>
    </div>
  );
}

/* -------------------------------- table ---------------------------------- */

export function TableWrap({ children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${THEME.border}` }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

export function Th({ children }) {
  return (
    <th className="text-left px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: THEME.textDim }}>
      {children}
    </th>
  );
}

export function Td({ children, ...rest }) {
  return (
    <td className="px-3 py-2.5 align-top" style={{ maxWidth: 280 }} {...rest}>
      {children}
    </td>
  );
}

/* ------------------------------ form shell -------------------------------- */

/** Collapsible "New entry" form with a single Save button and error surface. */
export function FormShell({ open, onToggle, accent, label = 'New Entry', onSubmit, children, saving, error, disabled }) {
  if (disabled) return null;
  return (
    <>
      {!open && (
        <Btn accent={accent} icon={Plus} onClick={onToggle} className="w-full sm:w-auto mb-5">
          {label}
        </Btn>
      )}
      {open && (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl mb-6"
          style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
        >
          {children}
          {error && (
            <div className="md:col-span-2 text-xs px-3 py-2 rounded-lg" style={{ color: THEME.red, background: 'rgba(215,38,61,0.1)' }}>
              {error}
            </div>
          )}
          <div className="md:col-span-2 flex gap-2 justify-end pt-1">
            <Btn type="button" variant="subtle" onClick={onToggle}>Cancel</Btn>
            <Btn type="submit" accent={accent} disabled={saving} icon={saving ? Loader2 : undefined}>
              {saving ? 'Saving…' : 'Save'}
            </Btn>
          </div>
        </form>
      )}
    </>
  );
}
