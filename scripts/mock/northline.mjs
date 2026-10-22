// Northline Cold Chain: the main sample. All content is fictional.
// Findings for the latest audit are written out in full; earlier audits are
// derived from them by topic so compare can match findings across audits.

export const company = {
  id: 'northline',
  title: 'Northline Cold Chain',
  description: 'Chilled last-mile delivery for independent food retailers across the North of England.',
  industry: 'Logistics / Supply Chain',
  country: 'United Kingdom',
  city: 'Leeds',
  model: 'Per-drop fee with a monthly minimum',
  target: 'Independent food retailers within 40 miles of the depot',
  type: 'startup',
  dealLead: 'Alex Morgan',
  stage: 'Seed',
  fund: 'Fund II',
  budget: '£100,000 to £500,000',
  cadence: { mode: 'inherit', paused: false, resumeOn: null },
};

export const sources = [
  { id: 'nl-s1', type: 'uploaded', title: 'Deck v3', kind: 'PDF', date: '2026-10-02', reliability: 'Medium', note: 'Company pitch deck, third version. Expansion plan and route assumptions.' },
  { id: 'nl-s2', type: 'uploaded', title: 'Q3 board update', kind: 'PDF', date: '2026-09-30', reliability: 'High', note: 'Quarterly board pack with route density, burn and retention.' },
  { id: 'nl-s3', type: 'uploaded', title: 'Unit economics model', kind: 'Spreadsheet', date: '2026-10-02', reliability: 'High', note: 'Fuel, driver and stop-density assumptions supplied by the company.' },
  { id: 'nl-s4', type: 'public', title: 'National courier regional launch notice', kind: 'Web page, trade press', date: '2026-09-09', reliability: 'Medium', url: 'https://example.com/trade-press/regional-chilled-launch', note: 'A national courier announced chilled delivery to independent retailers in the region.' },
  { id: 'nl-s5', type: 'uploaded', title: 'Supplier contract summary', kind: 'PDF', date: '2026-09-28', reliability: 'High', note: 'Refrigeration servicing and vehicle lease terms.' },
  { id: 'nl-s6', type: 'public', title: 'Food safety and cold-chain handling guidance', kind: 'Web page, UK regulator', date: '2026-10-01', reliability: 'High', url: 'https://example.com/regulator/cold-chain-guidance', note: 'Guidance on temperature-controlled transport and record keeping.' },
  { id: 'nl-s7', type: 'uploaded', title: 'Customer interview notes', kind: 'Document', date: '2026-10-02', reliability: 'Medium', note: 'Eleven interviews with current and lapsed customers.' },
  { id: 'nl-s8', type: 'public', title: 'Regional freight index', kind: 'Web page, industry body', date: '2026-09-30', reliability: 'High', url: 'https://example.com/freight-index/q3', note: 'Quarterly index of regional freight rates.' },
  { id: 'nl-s9', type: 'uploaded', title: 'Q2 board update', kind: 'PDF', date: '2026-07-12', reliability: 'High', superseded: true, note: 'Superseded by the Q3 board update.' },
  { id: 'nl-s10', type: 'uploaded', title: 'Deck v2', kind: 'PDF', date: '2026-04-02', reliability: 'Medium', superseded: true, note: 'Superseded by Deck v3.' },
];

// [agent, section, category, severity, topic, title, text, sources]
export const latestFindings = [
  // Market (58)
  [3, 'sat', 'Market', 'HIGH', 'clone-software', 'Route software is cloneable', 'Routing and temperature logging are available off the shelf and take weeks to set up. Nothing in the product is hard to copy.', ['nl-s1']],
  [3, 'sat', 'Market', 'MEDIUM', 'relationship-moat', 'Retailer trust is the only moat', 'What a competitor cannot copy quickly is the trust of independent grocers, and the plan does not yet protect it with contracts.', ['nl-s1', 'nl-s5']],
  [4, 'dem', 'Market', 'MEDIUM', 'market-ceiling', 'Independent grocer market is finite', 'The addressable base within 40 miles of one depot caps revenue well below the deck projection without a second site.', ['nl-s1']],
  [3, 'sat', 'Market', 'MEDIUM', 'regional-entrants', 'Two regional operators could add chilled vans', 'Existing ambient couriers in Yorkshire could add refrigerated vehicles with modest capital.', []],
  // Financial (66)
  [1, 'exec', 'Financial', 'HIGH', 'drop-economics', 'Every drop below 14 stops loses money', 'Revenue per drop averages below the fully loaded cost of a refrigerated van run. The deck assumes 18 stops per route from month four; actual density last quarter was 11.', ['nl-s2', 'nl-s3']],
  [1, 'fin', 'Financial', 'HIGH', 'runway', 'Base-case cash lasts nine months', 'At current burn the business reaches zero cash in month nine. A 10% price cut forced by a competitor cuts runway to six months.', ['nl-s2', 'nl-s3']],
  [1, 'fin', 'Financial', 'MEDIUM', 'upside-case', 'Upside case is not supported', 'Gross margin turns positive only above the 14-stop threshold. The upside case assumes it is reached by month five, which the evidence does not support.', ['nl-s3']],
  [1, 'fail', 'Financial', 'LOW', 'fuel-cost', 'Fuel cost exposure is unhedged', 'Diesel is roughly a fifth of route cost and no fuel surcharge clause is in the standard terms.', ['nl-s3', 'nl-s8']],
  [1, 'fin', 'Financial', 'LOW', 'payment-terms', 'Retailers pay on 30-day terms', 'Thirty-day terms on small accounts add working capital strain as volume grows.', []],
  // Operational (64)
  [1, 'ops', 'Operational', 'HIGH', 'single-depot', 'One depot, no fallback', 'A single depot serves the whole region. A fault during a Friday run puts the weekend order cycle for every retailer at risk.', ['nl-s2', 'nl-s5']],
  [1, 'ops', 'Operational', 'HIGH', 'single-vendor', 'One refrigeration vendor services every van', 'All refrigeration units are serviced by one vendor with a 48-hour response time.', ['nl-s5']],
  [1, 'fail', 'Operational', 'LOW', 'spoilage', 'Spoilage is above the sector range', 'Spoilage claims ran above the range seen in comparable chilled operators last quarter.', ['nl-s2']],
  [1, 'ops', 'Operational', 'LOW', 'driver-turnover', 'Driver turnover is rising', 'Three of nine drivers left in the quarter; training a replacement takes two weeks.', ['nl-s2']],
  [1, 'ops', 'Operational', 'LOW', 'manual-routing', 'Routes are planned by hand each evening', 'Manual planning limits how fast density can be improved.', []],
  [1, 'fail', 'Operational', 'LOW', 'key-person', 'Operations rest on the founder', 'Route planning and vendor relationships sit with one person.', []],
  // Competition (78)
  [2, 'comp', 'Competition', 'HIGH', 'national-courier', 'A national courier can undercut on price', 'The national courier already holds the vehicles, depots and driver pool the Leeds corridor needs, and its launch notice lists chilled delivery to independent retailers.', ['nl-s4']],
  [2, 'comp', 'Competition', 'HIGH', 'service-match', 'Service can be matched within one quarter', 'Same-day chilled slots are the main differentiator, and the entrant can offer them from existing hubs.', ['nl-s4', 'nl-s1']],
  [2, 'comp', 'Competition', 'HIGH', 'price-war', 'A price war would end the runway', 'Matching a 10% price cut moves every route below break-even at current density.', ['nl-s3', 'nl-s4']],
  [2, 'comp', 'Competition', 'MEDIUM', 'wholesaler-delivery', 'Wholesalers may bundle delivery', 'Two regional wholesalers already deliver ambient goods and could bundle chilled lines.', []],
  // Customer psychology (49)
  [4, 'psy', 'Customer psychology', 'HIGH', 'price-switching', 'Grocers switch on price when service is equal', 'Retailers rank reliability first and price second, but only while reliability is visibly better. Once a larger courier matches it, switching cost is close to zero.', ['nl-s4', 'nl-s7']],
  [4, 'psy', 'Customer psychology', 'MEDIUM', 'no-contracts', 'No accounts are on annual terms', 'All accounts can leave at a month\'s notice.', ['nl-s5']],
  [4, 'dem', 'Customer psychology', 'LOW', 'demand-proven', 'Demand is proven', 'Repeat orders are stable and two accounts asked for a sixth delivery day. Demand is not the constraint.', ['nl-s2']],
  [4, 'psy', 'Customer psychology', 'LOW', 'brand-awareness', 'Low brand awareness outside Leeds', 'Interviewees outside Leeds had not heard of the service.', ['nl-s7']],
  [4, 'psy', 'Customer psychology', 'LOW', 'complaint-handling', 'Complaints are handled by phone only', 'No written record of complaints makes service quality hard to prove to new accounts.', []],
  // Geographic (51)
  [2, 'geo', 'Geographic', 'HIGH', 'second-depot', 'Expansion needs a second depot the plan does not fund', 'The expansion slide targets Manchester and Newcastle without a second site in the use of funds.', ['nl-s1']],
  [2, 'geo', 'Geographic', 'MEDIUM', 'distance-limit', 'Delivery targets break beyond 40 miles', 'Three of the five largest accounts sit more than 25 miles from the depot, which lowers density and raises spoilage exposure.', ['nl-s1', 'nl-s3']],
  [2, 'geo', 'Geographic', 'MEDIUM', 'rural-density', 'Rural accounts lower density further', 'Rural stops add time per drop with no price premium.', ['nl-s3']],
  [2, 'geo', 'Geographic', 'LOW', 'congestion', 'City-centre congestion windows', 'Clean air zone and loading restrictions narrow city-centre delivery windows.', []],
  // Regulatory (37)
  [5, 'reg', 'Regulatory', 'HIGH', 'audit-trail', 'Temperature records are not inspection-ready', 'Loggers capture temperature continuously, but records are not exported in a form an inspector can review per delivery. Fixable without new hardware.', ['nl-s6', 'nl-s2']],
  [5, 'reg', 'Regulatory', 'LOW', 'licensing', 'Licensing path is clear', 'Operator licensing requirements are known and already met.', ['nl-s6']],
  [5, 'reg', 'Regulatory', 'LOW', 'insurance', 'Cold-chain failure cover is costly', 'Cargo and temperature-excursion cover quotes are high for the fleet size.', []],
  [5, 'reg', 'Regulatory', 'LOW', 'data-protection', 'Customer data handling is informal', 'Retailer contact data sits in spreadsheets without a retention policy.', []],
];

export const latestOrchestrator = {
  rationale: 'Demand is real. The delivery model loses money on every drop at current route density, and a funded national courier entered the Leeds corridor in September. Change pricing and route model before any further capital goes in.',
  investor: 'The business has demand and a real customer base. The constraint is structural, so more capital would fund more loss-making routes. Funding should follow a density target, not precede it.',
  roadmap: 'Days 0 to 30: reprice and cut sub-threshold routes. Days 30 to 90: sign annual agreements with the top five accounts. Day 90: re-audit. Move to PROCEED when density holds at 14 stops or more for eight weeks.',
  topRiskTopics: ['drop-economics', 'national-courier', 'runway'],
};

// Earlier audits: topic -> severity override, or null to drop the finding.
export const history = [
  {
    id: 'northline-1', date: '2026-01-14', calibration: 'cal-2026.1',
    sources: ['nl-s1'],
    change: { 'national-courier': null, 'service-match': null, 'price-war': null, 'price-switching': 'MEDIUM', 'demand-proven': 'MEDIUM', 'relationship-moat': 'HIGH', 'no-contracts': 'HIGH', 'audit-trail': 'HIGH', 'drop-economics': 'HIGH', 'runway': 'HIGH', 'second-depot': 'HIGH' },
    extra: [
      [5, 'reg', 'Regulatory', 'HIGH', 'no-logging', 'No temperature audit trail in place', 'There is no logging on two of the vans.', ['nl-s1']],
      [1, 'fin', 'Financial', 'HIGH', 'no-revenue-data', 'No operating data supplied', 'Only the deck was supplied, so unit economics rest on assumptions.', []],
      [4, 'dem', 'Market', 'HIGH', 'demand-unproven', 'Demand is claimed, not shown', 'No repeat order data yet.', ['nl-s1']],
      [1, 'ops', 'Operational', 'MEDIUM', 'no-routing', 'No routing system', 'Routes are improvised daily.', []],
    ],
    rationale: 'No route to positive unit economics is shown and demand is not yet proven.',
    trigger: 'manual',
  },
  {
    id: 'northline-2', date: '2026-04-08', calibration: 'cal-2026.1',
    sources: ['nl-s10', 'nl-s3'],
    change: { 'service-match': null, 'price-war': null, 'national-courier': 'MEDIUM' },
    extra: [
      [5, 'reg', 'Regulatory', 'MEDIUM', 'no-logging', 'Audit trail is partly in place', 'Logging is fitted but records are not kept per delivery.', ['nl-s10']],
      [1, 'fin', 'Financial', 'MEDIUM', 'no-revenue-data', 'Operating data is thin', 'One quarter of operating data supplied.', ['nl-s3']],
      [4, 'dem', 'Market', 'MEDIUM', 'demand-unproven', 'Repeat orders are early', 'Two months of repeat orders only.', ['nl-s10']],
    ],
    rationale: 'Fix density before expanding.',
    trigger: 'scheduled',
  },
  {
    id: 'northline-3', date: '2026-07-08', calibration: 'cal-2026.2',
    sources: ['nl-s10', 'nl-s3', 'nl-s9'],
    change: { 'national-courier': null, 'price-war': null, 'service-match': 'MEDIUM', 'price-switching': 'MEDIUM', 'audit-trail': 'MEDIUM', 'drop-economics': 'MEDIUM' },
    extra: [
      [1, 'ops', 'Operational', 'MEDIUM', 'anchor-account', 'Density gains rest on one anchor account', 'The anchor grocer signed in June accounts for most of the density improvement.', ['nl-s9']],
    ],
    rationale: 'Density briefly reached 14 stops and margin turned positive. Re-audit once density holds for a quarter.',
    trigger: 'scheduled',
  },
];
