/**
 * Fallback business details for printed documents. The real values live in
 * the database (Admin Control → Company details, table org_settings) and win
 * over these; this only fills gaps until they're entered.
 */
export const COMPANY = {
  name: 'DIVINE ENGINEERING SERVICES',
  tagline: 'Fire Fighting & Electrical Contracting',
  address: 'SF, SHOP NO SF 241, Panchsheel Square, Crossings Republik, Ghaziabad, Uttar Pradesh, 201016',
  phone: '+91-9212033445',
  email: 'divinemepservices@gmail.com, desindia1990@gmail.com',
  gstin: '09GTDPS9124P1ZP',

  // Delivery challan wording. Admin edits these in Admin Control; these are
  // only the fallback for a database that hasn't been seeded yet.
  challan_terms: [
    'E. & O.E',
    'Goods Once Sold will not be taken back',
    'Interest @24% P.A will be charged if the payment is not made within the stipulated time.',
  ].join('\n'),
  challan_jurisdiction: 'GHAZIABAD',
  challan_tools_note:
    'Tools and Tackles TRANSFER are NOT FOR SALE and solely the Property of '
    + 'M/s DIVINE ENGINEERING SERVICES for the execution of Site purpose only, and any damage, '
    + 'capturing or theft of the Tools is subject to Legal action.',
  challan_footer: 'For DIVINE ENGINEERING SERVICES',
};
