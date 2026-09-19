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

/* ----------------------------- delivery notes ----------------------------- */

export const RECEIPT_STATUS_LABEL = {
  submitted: 'Awaiting office check',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const RECEIPT_STATUS_TONE = { submitted: 'amber', accepted: 'green', rejected: 'red' };

/** A receipt the site has confirmed but the office has not checked yet. */
export const isAwaitingAcceptance = (g) => (g?.status ?? 'submitted') === 'submitted';

/**
 * Where a request has actually reached, as the site and the office see it:
 *   1 raised → 2 approved → 3 order placed → 4 material received
 * Only ACCEPTED receipts count as received (the database agrees — see
 * recompute_request()), so a delivery the site has confirmed but the office
 * has not checked reads as "waiting for office to accept", never "not
 * received".
 *
 * receipts: goods_receipts rows for this request (extra rows are filtered out).
 * Returns { step, of, key, label, tone, awaiting } — awaiting = how many of its
 * receipts are still waiting for the office.
 */
export function requestProgress(request, receipts = []) {
  const status = request?.status ?? 'submitted';
  const mine = receipts.filter((g) => !g.request_id || !request?.id || g.request_id === request.id);
  const awaiting = mine.filter(isAwaitingAcceptance).length;
  const of = 4;
  const at = (step, key, label, tone) => ({ step, of, key, label, tone, awaiting });

  if (status === 'rejected') return at(1, 'rejected', 'Rejected by the office', 'red');
  if (status === 'cancelled') return at(1, 'cancelled', 'Cancelled', 'dim');
  if (status === 'submitted') return at(1, 'raised', 'Raised — waiting for the office to approve', 'amber');
  if (status === 'approved') return at(2, 'approved', 'Approved — order still to be placed', 'blue');

  if (status === 'ordered' || status === 'partially_received') {
    if (awaiting > 0) {
      return at(3, 'awaiting_acceptance', 'Delivery confirmed by site — waiting for office to accept', 'amber');
    }
    if (status === 'partially_received') return at(3, 'part_received', 'Part received — rest still awaited', 'amber');
    return at(3, 'ordered', 'Order placed — awaiting delivery at site', 'blue');
  }

  if (status === 'received') return at(4, 'received', 'Material received in full', 'green');
  if (status === 'closed') return at(4, 'closed', 'Closed', 'dim');
  return at(1, 'raised', REQUEST_STATUS_LABEL[status] ?? 'Raised', 'dim');
}

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
