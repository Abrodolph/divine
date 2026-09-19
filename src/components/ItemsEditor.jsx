import { Plus, Trash2 } from 'lucide-react';
import { THEME } from '../lib/theme';

const EMPTY = { name: '', make: '', qty: '', unit: '' };
export const emptyItems = () => [{ ...EMPTY }];

/**
 * Repeating item rows used by the Delivery Challan form. `make` (the brand
 * printed in the challan's MAKE column) is optional — pass `showMake` to ask
 * for it. Rows saved before the column existed simply have no `make` key.
 */
export default function ItemsEditor({
  items, setItems, accent = THEME.orange, label = 'Materials / Items', showMake = false,
}) {
  const update = (i, key, val) =>
    setItems(items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  const add = () => setItems([...items, { ...EMPTY }]);
  const remove = (i) => setItems(items.length === 1 ? emptyItems() : items.filter((_, idx) => idx !== i));

  const input = 'bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none';
  const style = { borderColor: THEME.border, color: THEME.text };

  return (
    <div className="md:col-span-2">
      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
        {label}
      </label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              placeholder="Item description"
              value={it.name}
              onChange={(e) => update(i, 'name', e.target.value)}
              className={`flex-1 min-w-0 ${input}`}
              style={style}
            />
            {showMake && (
              <input
                placeholder="Make"
                value={it.make ?? ''}
                onChange={(e) => update(i, 'make', e.target.value)}
                className={`w-24 shrink-0 ${input}`}
                style={style}
              />
            )}
            <input
              placeholder="Qty"
              value={it.qty}
              onChange={(e) => update(i, 'qty', e.target.value)}
              className={`w-20 shrink-0 ${input}`}
              style={style}
            />
            <input
              placeholder="Unit"
              value={it.unit}
              onChange={(e) => update(i, 'unit', e.target.value)}
              className={`w-20 shrink-0 ${input}`}
              style={style}
            />
            <button type="button" onClick={() => remove(i)} className="p-2 shrink-0"
              style={{ color: THEME.textDim }} aria-label="Remove row">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color: accent }}>
        <Plus size={14} /> Add another item
      </button>
    </div>
  );
}

export const itemsSummary = (items = []) =>
  items
    .map((i) => `${i.name}${i.make ? ` (${i.make})` : ''} x${i.qty}${i.unit ? ' ' + i.unit : ''}`)
    .join('; ');
