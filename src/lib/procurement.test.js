import { describe, expect, it } from 'vitest';
import { canMove, comparative, lineTotals, poLinesFromQuote, receiptLinesForPo, remainingToOrder } from './procurement';

const items = [
  { id: 'i1', item_id: 'pipe', description: 'M.S PIPE', size: '100MM', qty: 30, unit: 'MTR', qty_ordered: 0 },
  { id: 'i2', item_id: null, description: 'Sprinkler head', size: null, qty: 12, unit: 'NOS', qty_ordered: 0 },
];
const shah = { id: 'q1', items: [{ request_item_id: 'i1', price: 410, gst_pct: 18 }, { request_item_id: 'i2', price: 95, gst_pct: 18 }] };
const mehta = { id: 'q2', items: [{ request_item_id: 'i1', price: 395, gst_pct: 18 }, { request_item_id: 'i2', price: 120, gst_pct: 18 }] };
const partial = { id: 'q3', items: [{ request_item_id: 'i1', price: 380, gst_pct: 18 }, { request_item_id: 'i2', price: '' }] };

describe('request status machine', () => {
  it('allows the human moves and nothing else', () => {
    expect(canMove('submitted', 'approved')).toBe(true);
    expect(canMove('rejected', 'submitted')).toBe(true);
    expect(canMove('submitted', 'received')).toBe(false);
    expect(canMove('closed', 'submitted')).toBe(false);
    expect(canMove('ordered', 'cancelled')).toBe(false);
  });
});

describe('quote maths', () => {
  it('totals lines with GST', () => {
    expect(lineTotals([{ qty: 30, price: 410, gst_pct: 18 }, { qty: 12, price: 95, gst_pct: 12 }]))
      .toEqual({ subtotal: 13440, gst: 2350.8, total: 15790.8 });
  });

  it('builds a comparative statement with the lowest price per item', () => {
    const c = comparative(items, [shah, mehta, partial]);
    expect(c.rows[0].cells.q3.lowest).toBe(true);
    expect(c.rows[0].cells.q1.lowest).toBe(false);
    expect(c.rows[1].cells.q1.lowest).toBe(true);
    expect(c.rows[1].cells.q3).toBeUndefined();
    expect(c.totals.q1).toMatchObject({ subtotal: 13440, complete: true });
    expect(c.totals.q2).toMatchObject({ subtotal: 13290, complete: true });
    expect(c.totals.q3).toMatchObject({ covered: 1, complete: false });
    // q3 is cheapest but doesn't price everything; q2 is the best complete quote
    expect(c.bestQuoteId).toBe('q2');
  });

  it('a single quote marks nothing as "lowest"', () => {
    expect(comparative(items, [shah]).rows[0].cells.q1.lowest).toBe(false);
  });
});

describe('orders and receipts', () => {
  it('orders only what is still outstanding, from lines the vendor priced', () => {
    const partlyOrdered = [{ ...items[0], qty_ordered: 10 }, items[1]];
    expect(remainingToOrder(partlyOrdered[0])).toBe(20);
    const lines = poLinesFromQuote(partial, partlyOrdered);
    expect(lines).toEqual([{ request_item_id: 'i1', item_id: 'pipe', description: 'M.S PIPE', size: '100MM', unit: 'MTR', qty: 20, price: 380, gst_pct: 18 }]);
  });

  it('shows what is pending against each PO line', () => {
    const po = { id: 'po1', items: [{ request_item_id: 'i1', description: 'M.S PIPE', qty: 30 }, { request_item_id: 'i2', description: 'Head', qty: 12 }] };
    const receipts = [{ po_id: 'po1', items: [{ po_line: 0, qty_received: 20 }] }, { po_id: 'other', items: [{ po_line: 0, qty_received: 99 }] }];
    expect(receiptLinesForPo(po, receipts).map((l) => [l.already_received, l.pending])).toEqual([[20, 10], [0, 12]]);
  });
});
