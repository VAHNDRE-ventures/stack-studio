/**
 * Verified free-tier / pricing catalog (generic public pricing, access 2026-07-20).
 * Sourced by the bloodhound research pass. Keyed by keyword match so any project
 * — however its cost is (or isn't) encoded — can surface the real cliffs.
 * `rank` = global order cliffs are hit (1 = soonest). Cloudflare Workers/KV/Pages
 * share one $5/mo floor (sharedFloor: 'cloudflare').
 */
export interface RateEntry {
  key: string;
  match: string[];
  label: string;
  freeAllowance?: { amount: number; unit: string; per: string };
  monthlyFloor?: number;
  transaction?: { percent?: number; fixed?: number };
  binding: string;
  rank: number;
  sharedFloor?: string;
  source: string;
  lastVerified: string;
}

const V = '2026-07-20';

export const RATE_CATALOG: RateEntry[] = [
  {
    key: 'resend',
    match: ['resend'],
    label: 'Resend',
    freeAllowance: { amount: 100, unit: 'emails', per: 'day' },
    monthlyFloor: 20,
    binding: '100 emails/day (hard cap; Pro $20/mo)',
    rank: 1,
    source: 'resend.com/pricing',
    lastVerified: V,
  },
  {
    key: 'sanity',
    match: ['sanity'],
    label: 'Sanity',
    freeAllowance: { amount: 10000, unit: 'documents', per: 'month' },
    monthlyFloor: 15,
    binding: '10k documents / 1M CDN req/mo (Growth $15/seat/mo)',
    rank: 2,
    source: 'sanity.io/pricing',
    lastVerified: V,
  },
  {
    key: 'cf-kv',
    match: ['kv'],
    label: 'Cloudflare KV',
    freeAllowance: { amount: 1000, unit: 'writes', per: 'day' },
    monthlyFloor: 5,
    binding: '1,000 writes/day (account-wide)',
    rank: 3,
    sharedFloor: 'cloudflare',
    source: 'developers.cloudflare.com/kv/platform/pricing/',
    lastVerified: V,
  },
  {
    key: 'cf-workers',
    match: ['worker', 'workers'],
    label: 'Cloudflare Workers',
    freeAllowance: { amount: 100000, unit: 'requests', per: 'day' },
    monthlyFloor: 5,
    binding: '100k requests/day (Paid $5/mo)',
    rank: 4,
    sharedFloor: 'cloudflare',
    source: 'developers.cloudflare.com/workers/platform/pricing/',
    lastVerified: V,
  },
  {
    key: 'cf-pages',
    match: ['pages'],
    label: 'Cloudflare Pages',
    freeAllowance: { amount: 500, unit: 'builds', per: 'month' },
    binding: '500 builds/month',
    rank: 5,
    sharedFloor: 'cloudflare',
    source: 'developers.cloudflare.com/pages/platform/limits/',
    lastVerified: V,
  },
  {
    key: 'easypost',
    match: ['easypost'],
    label: 'EasyPost',
    freeAllowance: { amount: 3000, unit: 'labels', per: 'month' },
    binding: '3,000 labels/month, then $0.08/label',
    rank: 6,
    source: 'support.easypost.com',
    lastVerified: V,
  },
  {
    key: 'cf-access',
    match: ['zero trust', 'access'],
    label: 'Cloudflare Access',
    freeAllowance: { amount: 50, unit: 'seats', per: 'month' },
    binding: '50 seats (then per-seat)',
    rank: 97,
    sharedFloor: 'cloudflare',
    source: 'cloudflare.com/plans/zero-trust-services/',
    lastVerified: V,
  },
  {
    key: 'cf-turnstile',
    match: ['turnstile'],
    label: 'Turnstile',
    binding: 'free (managed mode)',
    rank: 98,
    source: 'developers.cloudflare.com/turnstile/plans/',
    lastVerified: V,
  },
  {
    key: 'paypal',
    match: ['paypal'],
    label: 'PayPal',
    transaction: { percent: 3.49, fixed: 0.49 },
    binding: 'paid from txn #1 (3.49% + $0.49)',
    rank: 90,
    source: 'paypal.com/us/business/paypal-business-fees',
    lastVerified: V,
  },
  {
    key: 'coinbase',
    match: ['coinbase'],
    label: 'Coinbase Commerce',
    transaction: { percent: 1 },
    binding: 'paid from txn #1 (1%)',
    rank: 91,
    source: 'coinbase.com/commerce',
    lastVerified: V,
  },
];

/** Best (lowest-rank) catalog entry matching a node's name/technology/provider text. */
export function matchRate(text: string): RateEntry | undefined {
  const h = text.toLowerCase();
  const hits = RATE_CATALOG.filter((e) => e.match.some((m) => h.includes(m)));
  return hits.sort((a, b) => a.rank - b.rank)[0];
}
