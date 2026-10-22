// Finding text bank for generated companies and for audits run in the prototype. Fictional.
// Order matters: earlier entries take the higher severities.

export const CATEGORY_HOME = {
  Market: [3, 'sat'],
  Financial: [1, 'fin'],
  Operational: [1, 'ops'],
  Competition: [2, 'comp'],
  'Customer psychology': [4, 'psy'],
  Geographic: [2, 'geo'],
  Regulatory: [5, 'reg'],
};

export const BANK = {
  Market: [
    ['crowded-segment', 'The segment is crowded', 'At least four funded players sell a similar offer to the same buyers in {city}.'],
    ['market-size', 'Addressable market is smaller than claimed', 'The market sizing counts adjacent segments that the product does not serve today.'],
    ['easy-clone', 'Core offer is easy to replicate', 'The description names no feature that a larger player could not build within two quarters.'],
    ['timing', 'Market timing is uncertain', 'Buyer budgets in this segment are under review for the next financial year.'],
    ['channel-reliance', 'Growth relies on one channel', 'Most new customers arrive through a single partner channel.'],
    ['category-education', 'Buyers need educating', 'The category is new to most buyers, which lengthens the sales cycle.'],
  ],
  Financial: [
    ['burn', 'Burn outpaces revenue growth', 'Monthly burn grew faster than revenue over the last two quarters.'],
    ['runway-short', 'Runway is short', 'Cash at the current burn lasts less than twelve months.'],
    ['margin-thin', 'Gross margin is thin', 'Gross margin sits below the range seen in comparable businesses.'],
    ['concentration', 'Revenue is concentrated', 'The top three customers account for more than half of revenue.'],
    ['pricing-untested', 'Pricing is untested at scale', 'Current prices are discounted pilots; list prices have not been accepted yet.'],
    ['working-capital', 'Working capital strain', 'Payment terms leave the business funding its customers.'],
  ],
  Operational: [
    ['key-person', 'Delivery rests on one person', 'A single founder holds the critical supplier and customer relationships.'],
    ['supplier-dependency', 'Single supplier dependency', 'One supplier provides a component with no tested alternative.'],
    ['scaling-process', 'Processes will not scale', 'Core operations are manual and will not hold at twice the volume.'],
    ['hiring', 'Hiring plan is behind', 'Two of the four planned senior hires are unfilled.'],
    ['quality', 'Quality control is informal', 'There is no written quality process for the core service.'],
    ['systems', 'Systems are stitched together', 'Customer data sits across spreadsheets and two unconnected tools.'],
  ],
  Competition: [
    ['funded-entrant', 'A funded entrant can undercut on price', 'A competitor with recent funding announced a lower-priced offer for the same buyers.'],
    ['incumbent-bundle', 'An incumbent could bundle the feature', 'The leading platform in the category could add this as a feature for existing customers.'],
    ['price-pressure', 'Price pressure is likely', 'Two competitors cut prices in the last quarter.'],
    ['switching-low', 'Switching cost is low', 'Customers can move to a rival within a month with no data loss.'],
    ['partner-conflict', 'A key partner also competes', 'The main distribution partner sells a competing product.'],
    ['talent-competition', 'Rivals compete for the same talent', 'Larger rivals are hiring the same specialists at higher salaries.'],
  ],
  'Customer psychology': [
    ['trust-gap', 'Buyers do not yet trust the brand', 'Interviews show buyers prefer an established name for this purchase.'],
    ['price-sensitivity', 'Buyers are price-sensitive', 'Buyers ranked price first when service levels were similar.'],
    ['habit', 'Existing habits are hard to change', 'The product asks buyers to change a routine they are comfortable with.'],
    ['proof', 'Social proof is thin', 'There are few public references or case studies.'],
    ['churn-signal', 'Early churn signals', 'Usage dropped after the first month for a third of new accounts.'],
    ['onboarding', 'Onboarding takes too long', 'New customers take several weeks to see value.'],
  ],
  Geographic: [
    ['expansion-cost', 'Expansion beyond {city} is unfunded', 'The plan targets new regions without budget for local teams.'],
    ['local-rules', 'Local rules differ by region', 'Requirements outside the home market have not been reviewed.'],
    ['single-region', 'Revenue sits in one region', 'Almost all revenue comes from customers in and around {city}.'],
    ['logistics-reach', 'Reach is limited by distance', 'Service quality drops for customers far from the main site.'],
    ['currency', 'Currency exposure on costs', 'Some costs are paid in foreign currency without a hedge.'],
    ['talent-location', 'Talent pool is limited locally', 'Specialist roles are hard to fill in {city}.'],
  ],
  Regulatory: [
    ['approval-path', 'Regulatory approval path is long', 'The product needs approval that typically takes more than a year.'],
    ['compliance-gap', 'Compliance records are incomplete', 'Records required by the regulator are not yet kept in full.'],
    ['data-protection', 'Data protection is informal', 'Customer data handling lacks a written policy and retention rules.'],
    ['licence', 'A licence is still pending', 'An operating licence application has not been decided.'],
    ['ip-unprotected', 'Intellectual property is unprotected', 'No filings protect the core method.'],
    ['contracts', 'Customer contracts are non-standard', 'Each customer signed different terms, which complicates enforcement.'],
  ],
};

export const SOURCE_TEMPLATES = [
  { key: 'deck', type: 'uploaded', title: 'Company deck', kind: 'PDF', reliability: 'Medium', note: 'Pitch deck supplied by the company.' },
  { key: 'model', type: 'uploaded', title: 'Financial model', kind: 'Spreadsheet', reliability: 'High', note: 'Revenue, cost and cash assumptions.' },
  { key: 'market', type: 'public', title: 'Sector market report', kind: 'Web page, industry body', reliability: 'Medium', url: 'https://example.com/sector-report', note: 'Public sector overview with competitor list.' },
  { key: 'reg', type: 'public', title: 'Regulator guidance', kind: 'Web page, regulator', reliability: 'High', url: 'https://example.com/regulator-guidance', note: 'Official guidance relevant to the sector.' },
];

// Which source a generated finding cites, by category. null = agent reasoning.
export const CITE_BY_CATEGORY = {
  Market: ['market', null],
  Financial: ['model', 'deck'],
  Operational: ['deck', null],
  Competition: ['market', null],
  'Customer psychology': ['deck', null],
  Geographic: [null, 'deck'],
  Regulatory: ['reg', null],
};
