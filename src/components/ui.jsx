import { useEffect, useState } from 'react';
import { Download, Lock, Trash2, X, Loader2, Camera, Plus, FileText } from 'lucide-react';
import { THEME } from '../lib/theme';
import { isPdfRef, isPrivateRef, resolveFileUrl, uploadAttachment } from '../lib/upload';
import { exportCSV } from '../lib/csv';
import { fmtDate } from '../lib/format';

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

/** Small uppercase heading for a section inside a screen. */
export function SubHeading({ children, className = 'mt-8 mb-2', action }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <div className="text-sm font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
        {children}
      </div>
      {action}
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

export const TONES = {
  red: { c: THEME.red, bg: 'rgba(215,38,61,0.10)' },
  amber: { c: THEME.amber, bg: 'rgba(255,193,7,0.10)' },
  green: { c: THEME.green, bg: 'rgba(62,166,94,0.10)' },
  blue: { c: THEME.blue, bg: 'rgba(74,144,217,0.10)' },
  orange: { c: THEME.orange, bg: 'rgba(255,106,19,0.10)' },
  dim: { c: THEME.textDim, bg: 'rgba(155,161,166,0.08)' },
};

export function Banner({ tone = 'amber', icon: Icon, children }) {
  const t = TONES[tone] ?? TONES.amber;
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

/** A small coloured label: flags, statuses, counts. */
export function Chip({ tone = 'dim', children, title }) {
  const t = TONES[tone] ?? TONES.dim;
  return (
    <span title={title} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ color: t.c, background: t.bg }}>
      {children}
    </span>
  );
}

export function StatusBadge({ value }) {
  if (!value) return <span style={{ color: THEME.textDim }}>—</span>;
  const v = String(value).toLowerCase();
  let color = THEME.textDim;
  let bg = 'rgba(155,161,166,0.15)';
  if (['open', 'pending', 'for review', 'medium', 'due', 'draft'].includes(v)) {
    color = THEME.amber; bg = 'rgba(255,193,7,0.14)';
  } else if (['approved', 'fulfilled', 'closed', 'pass', 'issued', 'for construction', 'delivered', 'low', 'paid', 'final', 'verified'].includes(v)) {
    color = THEME.green; bg = 'rgba(62,166,94,0.14)';
  } else if (['fail', 'urgent', 'superseded', 'high', 'rejected', 'expired'].includes(v)) {
    color = THEME.red; bg = 'rgba(215,38,61,0.14)';
  } else if (['in progress', 'partial', 'sent'].includes(v)) {
    color = THEME.blue; bg = 'rgba(74,144,217,0.14)';
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ color, background: bg }}>
      {value}
    </span>
  );
}

/** Label-over-value pair used in detail popups. */
export function Info({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: THEME.textDim }}>{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

/** Label … value row used in money breakdowns. */
export function Line({ label, value, tone, bold }) {
  const color = tone === 'amber' ? THEME.amber : tone === 'green' ? THEME.green : tone === 'red' ? THEME.red : THEME.text;
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: THEME.textDim }}>{label}</span>
      <span className="text-right" style={{ color, fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, accent = THEME.orange }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{
              background: on ? `${accent}22` : THEME.panel,
              color: on ? accent : THEME.textDim,
              border: `1px solid ${on ? accent : THEME.border}`,
            }}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className="ml-1.5 opacity-80">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- buttons --------------------------------- */

export function Btn({ children, variant = 'primary', accent = THEME.orange, icon: Icon, className = '', style, ...rest }) {
  const styles = {
    primary: { background: accent, color: '#111', border: `1px solid ${accent}` },
    ghost: { background: 'transparent', color: THEME.textDim, border: `1px solid ${THEME.border}` },
    danger: { background: THEME.red, color: '#fff', border: `1px solid ${THEME.red}` },
    subtle: { background: THEME.panel2, color: THEME.text, border: `1px solid ${THEME.border}` },
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${className}`}
      style={{ ...styles[variant], ...style }}
      {...rest}
    >
      {Icon && <Icon size={15} className={Icon === Loader2 ? 'animate-spin' : undefined} />}
      {children}
    </button>
  );
}

export function IconBtn({ icon: Icon, title, ...rest }) {
  return (
    <button
      type="button"
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
      <button type="button" onClick={onDelete} className="px-2 py-1 rounded font-semibold" style={{ background: THEME.red, color: '#fff' }}>
        Delete
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 rounded" style={{ color: THEME.textDim }}>
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

export function LoadMore({ hasMore, onClick }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center mt-4">
      <Btn variant="ghost" onClick={onClick}>Load older entries</Btn>
    </div>
  );
}

/* -------------------------------- fields --------------------------------- */

const inputBase = 'w-full bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none';
const inputStyle = { borderColor: THEME.border, color: THEME.text };

export function Field({ label, required, hint, full, children }) {
  return (
    <div className={full ? 'md:col-span-2 sm:col-span-2' : ''}>
      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
        {label}
        {required && <span style={{ color: THEME.red }}> *</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] mt-1" style={{ color: THEME.textDim }}>{hint}</div>}
    </div>
  );
}

export function Input({ style, ...props }) {
  return <input className={inputBase} style={{ ...inputStyle, ...style }} {...props} />;
}

export function TextArea({ rows = 3, ...props }) {
  return <textarea rows={rows} className={inputBase} style={inputStyle} {...props} />;
}

export function Select({ options = [], placeholder = 'Select…', children, style, ...props }) {
  return (
    <select className={inputBase} style={{ ...inputStyle, ...style }} {...props}>
      {placeholder !== null && <option value="">{placeholder}</option>}
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

export function SiteSelect({ sites, placeholder = 'Select site…', ...props }) {
  return (
    <Select placeholder={placeholder} {...props}>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </Select>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} style={{ accentColor: THEME.orange }} />
      <span>
        {label}
        {hint && <span className="block text-[11px] mt-0.5" style={{ color: THEME.textDim }}>{hint}</span>}
      </span>
    </label>
  );
}

/** Labelled month / date picker used in screen toolbars. */
export function ToolbarInput({ label, type = 'month', ...props }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>{label}</label>
      <input
        type={type}
        className="bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ borderColor: THEME.border, color: THEME.text }}
        {...props}
      />
    </div>
  );
}

/* ------------------------------- files ----------------------------------- */

/** A stored file reference → a URL usable right now (signs private files). */
export function useFileUrl(ref) {
  const [url, setUrl] = useState(() => (ref && !isPrivateRef(ref) ? ref : null));
  useEffect(() => {
    let alive = true;
    if (!ref) { setUrl(null); return undefined; }
    if (!isPrivateRef(ref)) { setUrl(ref); return undefined; }
    resolveFileUrl(ref).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [ref]);
  return url;
}

export function StoredImage({ src, alt = '', className = '', style, ...rest }) {
  const url = useFileUrl(src);
  if (!url) return <div className={`${className} animate-pulse`} style={{ background: THEME.panel2, ...style }} />;
  return <img src={url} alt={alt} className={className} style={style} {...rest} />;
}

/** Opens a stored file (e.g. a PDF) in a new tab, signing it first if private. */
export function openStoredFile(ref) {
  const w = window.open('', '_blank');
  resolveFileUrl(ref).then((u) => {
    if (w && u) w.location.href = u;
    else if (w) w.close();
  });
}

function PdfTile({ fileRef, size }) {
  return (
    <button
      type="button"
      onClick={() => openStoredFile(fileRef)}
      className="flex flex-col items-center justify-center rounded-lg text-[11px] gap-1 shrink-0"
      style={{ height: size, width: size, border: `1px solid ${THEME.border}`, color: THEME.textDim }}
      title="Open PDF"
    >
      <FileText size={Math.round(size * 0.3)} />
      {size > 50 && <span>PDF</span>}
    </button>
  );
}

/**
 * Camera-first photo picker. Uploads straight to Storage and hands back
 * references, so records only ever carry a short link.
 *   private   upload to the private bucket (people's faces, documents)
 *   camera    'environment' | 'user' | false — false lets them pick a file
 */
export function PhotoInput({
  value = [], onChange, folder = 'misc', max = 6, label = 'Add photo', accept = 'image/*',
  private: isPrivate = false, camera = 'environment',
}) {
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
      const refs = [];
      for (const f of files) refs.push(await uploadAttachment(f, folder, { private: isPrivate }));
      onChange([...value, ...refs]);
    } catch (e2) {
      setErr(e2.message || 'Upload failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((ref, i) => (
          <div key={ref} className="relative">
            {isPdfRef(ref) ? (
              <PdfTile fileRef={ref} size={76} />
            ) : (
              <StoredImage src={ref} className="rounded-lg object-cover"
                style={{ height: 76, width: 76, border: `1px solid ${THEME.border}` }} />
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
            className="flex flex-col items-center justify-center rounded-lg cursor-pointer text-[11px] gap-1 text-center px-1"
            style={{ height: 76, width: 76, border: `1px dashed ${THEME.border}`, color: THEME.textDim }}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
            <span>{busy ? 'Sending…' : label}</span>
            <input
              type="file"
              accept={accept}
              capture={pdfAllowed || !camera ? undefined : camera}
              multiple={max - value.length > 1}
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
  if (!photos?.length) return <span style={{ color: THEME.textDim }}>—</span>;
  return (
    <div className="flex gap-1">
      {photos.slice(0, 4).map((p) => (
        isPdfRef(p) ? (
          <PdfTile key={p} fileRef={p} size={size} />
        ) : (
          <StoredImage
            key={p}
            src={p}
            onClick={() => onOpen?.(p)}
            className="rounded object-cover cursor-pointer shrink-0"
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
export function Modal({ open, onClose, title, accent = THEME.orange, wide = false, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-5`}
        style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="text-base font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em', color: accent }}>
            {title}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded shrink-0" style={{ color: THEME.textDim }} aria-label="Close">
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
      <StoredImage src={src} style={{ maxHeight: '90vh', maxWidth: '95vw', borderRadius: 8, minHeight: 120, minWidth: 120 }} />
      <button type="button" className="absolute top-4 right-4 p-2" style={{ color: '#fff' }} onClick={onClose} aria-label="Close">
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

export function Th({ children, className = '' }) {
  return (
    <th className={`text-left px-3 py-2.5 font-medium whitespace-nowrap ${className}`} style={{ color: THEME.textDim }}>
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
export function FormShell({ open, onToggle, accent, label = 'New Entry', onSubmit, children, saving, error, disabled, submitLabel = 'Save' }) {
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
          <FormError error={error} />
          <div className="md:col-span-2 flex gap-2 justify-end pt-1">
            <Btn type="button" variant="subtle" onClick={onToggle}>Cancel</Btn>
            <Btn type="submit" accent={accent} disabled={saving} icon={saving ? Loader2 : undefined}>
              {saving ? 'Saving…' : submitLabel}
            </Btn>
          </div>
        </form>
      )}
    </>
  );
}

export function FormError({ error }) {
  if (!error) return null;
  return (
    <div className="md:col-span-2 sm:col-span-2 text-xs px-3 py-2 rounded-lg" style={{ color: THEME.red, background: 'rgba(215,38,61,0.1)' }}>
      {error}
    </div>
  );
}

/** Expiry badge for documents: red when past, amber within 30 days. */
export function ExpiryBadge({ date }) {
  if (!date) return null;
  const days = Math.ceil((new Date(`${date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  if (days < 0) return <Chip tone="red">Expired {fmtDate(date)}</Chip>;
  if (days <= 30) return <Chip tone="amber">Expires in {days} d</Chip>;
  return <Chip tone="dim">Valid to {fmtDate(date)}</Chip>;
}
