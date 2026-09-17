/**
 * Procurement rules as pure functions: the request status machine (mirrors
 * purchase_requests_before() in supabase/schema.sql — change both together),
 * quote maths, and the comparative statement.
 */

export const REQUEST_STATUSES = [
  'submitted', 'approved', 'rejected', 'ordered', 'partially_received', 'received', 'closed', 'cancelled',
];

export const REQUEST_STATUS_LABEL = {
  submitted: 'Awaiting approval',
  approved: 'Approved — to order',
  rejected: 'Rejected',
  ordered: 'Ordered',
  partially_received: 'Part received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const REQUEST_STATUS_TONE = {
  submitted: 'amber', approved: 'blue', rejected: 'red', ordered: 'blue',
  partially_received: 'amber', received: 'green', closed: 'dim', cancelled: 'dim',
};

/** Moves a person can make. ordered / partially_received / received are derived from POs and GRNs. */
export const MANUAL_TRANSITIONS = {
  submitted: ['approved', 'rejected', 'cancelled'],
  rejected: ['submitted', 'cancelled'],
  approved: ['closed', 'cancelled'],
  ordered: ['closed'],
  partially_received: ['closed'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

export const canMove = (from, to) => (MANUAL_TRANSITIONS[from] ?? []).includes(to);

export const PO_STATUS_LABEL = {
  draft: 'Draft', sent: 'Sent', partially_received: 'Part received', received: 'Received', cancelled: 'Cancelled',
};

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(n * 100) / 100;

/** lines: [{ qty, price, gst_pct }] → { subtotal, gst, total } */
export function lineTotals(lines) {
  let subtotal = 0;
  let gst = 0;
  lines.forEach((l) => {
    const amount = num(l.qty) * num(l.price);
    subtotal += amount;
    gst += (amount * num(l.gst_pct)) / 100;
  });
  return { subtotal: r2(subtotal), gst: r2(gst), total: r2(subtotal + gst) };
}

/** A quote's priced lines joined to the request's quantities. */
export function quoteLines(quote, requestItems) {
  return (quote.items ?? [])
    .filter((q) => q.price !== '' && q.price !== null && q.price !== undefined)
    .map((q) => {
      const ri = requestItems.find((i) => i.id === q.request_item_id);
      return ri ? { ...q, qty: num(ri.qty), request_item: ri } : null;
    })
    .filter(Boolean);
}

/**
 * Comparative statement: one row per requested item, one column per quote.
 *  rows[i].cells[quoteId] = { price, gst_pct, amount, lowest }
 *  totals[quoteId]        = { subtotal, gst, total, covered, complete }
 *  bestQuoteId            = lowest total among quotes that price every item
 */
export function comparative(requestItems, quotes) {
  const rows = requestItems.map((item) => {
    const cells = {};
    quotes.forEach((q) => {
      const line = (q.items ?? []).find((l) => l.request_item_id === item.id);
      if (line && line.price !== '' && line.price !== null && line.price !== undefined) {
        cells[q.id] = { price: num(line.price), gst_pct: num(line.gst_pct), amount: r2(num(line.price) * num(item.qty)) };
      }
    });
    const prices = Object.values(cells).map((c) => c.price);
    const min = prices.length ? Math.min(...prices) : null;
    Object.values(cells).forEach((c) => { c.lowest = prices.length > 1 && c.price === min; });
    return { item, cells, lowest: min };
  });

  const totals = {};
  quotes.forEach((q) => {
    const lines = quoteLines(q, requestItems);
    totals[q.id] = { ...lineTotals(lines), covered: lines.length, complete: lines.length === requestItems.length };
  });

  const complete = quotes.filter((q) => totals[q.id].complete);
  const best = complete.length
    ? complete.reduce((a, b) => (totals[b.id].total < totals[a.id].total ? b : a))
    : null;

  return { rows, totals, bestQuoteId: best?.id ?? null };
}

/** Quantity still to order for each request line. */
export const remainingToOrder = (item) => Math.max(num(item.qty) - num(item.qty_ordered), 0);

/**
 * PO lines from a selected quote: every line the vendor priced that still has
 * quantity left to order.
 */
export function poLinesFromQuote(quote, requestItems) {
  return quoteLines(quote, requestItems)
    .map((l) => ({
      request_item_id: l.request_item_id,
      item_id: l.request_item.item_id ?? null,
      description: l.request_item.description,
      size: l.request_item.size ?? null,
      unit: l.request_item.unit ?? null,
      qty: remainingToOrder(l.request_item),
      price: num(l.price),
      gst_pct: num(l.gst_pct),
    }))
    .filter((l) => l.qty > 0);
}

/** GRN lines for a PO, with what's already been received against each line. */
export function receiptLinesForPo(po, receipts = []) {
  return (po.items ?? []).map((line, idx) => {
    const already = receipts
      .filter((g) => g.po_id === po.id)
      .flatMap((g) => g.items ?? [])
      .filter((l) => Number(l.po_line) === idx)
      .reduce((n, l) => n + num(l.qty_received), 0);
    return {
      po_line: idx,
      request_item_id: line.request_item_id ?? null,
      description: line.description,
      size: line.size ?? null,
      unit: line.unit ?? null,
      qty_ordered: num(line.qty),
      already_received: already,
      pending: Math.max(num(line.qty) - already, 0),
    };
  });
}

/** Human line for a request item: "M.S PIPE 100MM — 30 MTR" */
export const itemLabel = (i) => `${i.description}${i.size ? ` ${i.size}` : ''} — ${num(i.qty)}${i.unit ? ` ${i.unit}` : ''}`;
