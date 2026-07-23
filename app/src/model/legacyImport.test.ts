import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '@model/types';
import { importLegacy, isLegacyProject } from './legacyImport';
import { collectPlaced } from './flatten';
import { validateProject } from './validate';
import { analyzeCost } from './costForesight';
import { projectMonthly, flowCost } from './opCost';
import { ecommerce } from '../sample/ecommerce';

const fixture = {
  name: 'Demo',
  avgTransactionValue: 40,
  layers: [
    { id: 1, name: 'Web', type: 'Frontend', status: 'Active', connections: [{ targetId: 2, type: 'HTTP', label: 'api' }] },
    {
      id: 2,
      name: 'API',
      type: 'API',
      status: 'Active',
      technology: 'Cloudflare Workers',
      connections: [
        { targetId: 3, type: 'Database' },
        { targetId: 4, type: 'HTTP' },
      ],
    },
    {
      id: 3,
      name: 'Store',
      type: 'Database',
      status: 'Active',
      technology: 'Sanity content lake',
      substacks: [
        { id: '3_1', name: 'order', type: 'Other', status: 'Active', technology: 'Sanity document' },
        { id: '3_2', name: 'user', type: 'Other', status: 'Active', technology: 'document' },
      ],
    },
    { id: 4, name: 'PayPal', type: 'Backend', status: 'Active', technology: 'PayPal', costModel: { currency: 'USD', percentageCost: 2.9, percentageFixed: 0.3 } },
    { id: 5, name: 'Customer', type: 'Actor', status: 'Active' },
  ],
  usePaths: [
    { id: 'f1', name: 'Checkout', layersInvolved: [1, 2, 4], actionCost: { usageAssumptions: { estimatedCallsPerMonth: 500 } } },
  ],
};

describe('legacy import', () => {
  it('detects legacy projects', () => {
    expect(isLegacyProject(fixture)).toBe(true);
    expect(isLegacyProject({ modelVersion: '2.0.0', nodes: [] })).toBe(false);
  });

  it('maps kinds / ownership / cost / flows', () => {
    const p = importLegacy(fixture);
    const byId = new Map(p.nodes.map((n) => [String(n.id), n]));
    expect(byId.get('2')!.kind).toBe('serverless_function');
    expect(byId.get('3')!.kind).toBe('nosql_db');
    expect(byId.get('4')!.kind).toBe('external_system');
    expect(byId.get('4')!.ownership).toBe('thirdParty');
    expect(byId.get('5')!.kind).toBe('actor');
    expect(byId.get('3')!.children?.every((c) => c.kind === 'data_entity')).toBe(true);
    expect(byId.get('4')!.cost?.transactionFees?.[0].percent).toBe(2.9);
    expect(p.flows?.[0].steps.length).toBe(2);
    expect(p.flows?.[0].volume?.runsPerPeriod).toBe(500);
  });

  it('flatten keeps data entities as rooms, not buildings', () => {
    const placed = collectPlaced(importLegacy(fixture));
    const ids = placed.nodes.map((n) => String(n.id));
    expect(ids).not.toContain('3_1');
    expect(placed.dataCount['3']).toBe(2);
    expect(placed.remap['3_1']).toBe('3');
  });
});

// Local-only validation against the CURRENT R&O export (source of truth per the
// river-oak specialist). Reads from its out-of-repo path if present; nothing
// R&O is stored in this repo. Skipped elsewhere.
const dir = path.dirname(fileURLToPath(import.meta.url));
const roPath = path.resolve(dir, '../../../../river-oak/architecture/river-oak-current.stackstudio.json');
const hasRO = fs.existsSync(roPath);

const countNodes = (ns: Node[]): number => ns.reduce((s, n) => s + 1 + countNodes(n.children ?? []), 0);

describe.skipIf(!hasRO)('R&O current export (local only)', () => {
  it('imports + flattens the current architecture', () => {
    const raw = JSON.parse(fs.readFileSync(roPath, 'utf8'));
    expect(isLegacyProject(raw)).toBe(true);
    const p = importLegacy(raw);
    const placed = collectPlaced(p);
    const kinds: Record<string, number> = {};
    for (const n of placed.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
    const total = countNodes(p.nodes);
    // eslint-disable-next-line no-console
    console.log(
      'R&O FIDELITY REPORT:\n' +
        JSON.stringify(
          {
            name: p.name,
            totalModelNodes: total,
            placedBuildings: placed.nodes.length,
            dataEntitiesAsRooms: total - placed.nodes.length,
            edges: p.edges.length,
            flows: p.flows?.length,
            flowStepsMatched: p.flows?.map((f) => `${f.name}:${f.steps.length}`),
            buildingsByKind: kinds,
          },
          null,
          2,
        ),
    );
    expect(placed.nodes.length).toBeGreaterThan(5);
    expect(p.edges.length).toBeGreaterThan(5);
  });
});


describe('validate', () => {
  it('the v2 sample is valid', () => {
    expect(validateProject(ecommerce).errors).toEqual([]);
  });
  it('an imported legacy project is valid', () => {
    expect(validateProject(importLegacy(fixture)).errors).toEqual([]);
  });
  it('flags dangling edges and bad enums', () => {
    const bad = {
      modelVersion: '2.0.0',
      name: 'bad',
      nodes: [{ id: 'a', name: 'A', kind: 'not_a_kind', ownership: 'owned', buildState: 'active' }],
      edges: [{ id: 'e', source: 'a', target: 'ghost', kind: 'sync_request' }],
    };
    const r = validateProject(bad as unknown as Parameters<typeof validateProject>[0]);
    expect(r.errors.some((m) => m.includes('invalid kind'))).toBe(true);
    expect(r.errors.some((m) => m.includes("target 'ghost'"))).toBe(true);
  });
});

// Independent check of the specialist-authored native v2 file (local only).
const v2Path = path.resolve(dir, '../../../../river-oak/architecture/river-oak.v2.json');
describe.skipIf(!fs.existsSync(v2Path))('R&O native v2 (local only)', () => {
  it('passes our v2 validator and flattens cleanly', () => {
    const p = JSON.parse(fs.readFileSync(v2Path, 'utf8'));
    const r = validateProject(p);
    const placed = collectPlaced(p);
    const rooms = Object.values(placed.dataCount).reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(
      'R&O v2 INDEPENDENT VALIDATION:\n' +
        JSON.stringify(
          {
            errors: r.errors.length,
            warnings: r.warnings.length,
            firstErrors: r.errors.slice(0, 6),
            firstWarnings: r.warnings.slice(0, 6),
            buildings: placed.nodes.length,
            dataRooms: rooms,
            edges: p.edges?.length,
            zones: p.zones?.length,
            flows: p.flows?.length,
          },
          null,
          2,
        ),
    );
    expect(r.errors).toEqual([]);
    expect(placed.nodes.length).toBeGreaterThan(5);
  });

  it('yields driver-term cliffs from the usage model', () => {
    const p = JSON.parse(fs.readFileSync(v2Path, 'utf8'));
    const c1 = analyzeCost(p);
    const hi = analyzeCost(p, { ...(p.drivers ?? {}), orders: (p.drivers?.orders ?? 500) * 10 });
    // eslint-disable-next-line no-console
    console.log(
      'R&O v2 COST @baseline: ' +
        c1.headline +
        '\n  cliffs: ' +
        JSON.stringify(c1.catalogCliffs.map((x) => ({ l: x.label, t: x.crossText, over: x.crossed }))) +
        '\nR&O v2 COST @10× orders: ' +
        hi.headline,
    );
    expect(p.drivers).toBeTruthy();
    expect(c1.catalogCliffs.some((x) => x.crossText)).toBe(true);
  });

  it('surfaces non-zero prices (per-txn, projected/mo, paid flows)', () => {
    const p = JSON.parse(fs.readFileSync(v2Path, 'utf8'));
    const c = analyzeCost(p);
    const mp = projectMonthly(p);
    const flowRuns = (p.flows ?? []).map((f: { name: string }) => ({
      name: f.name,
      perRun: flowCost(p, f as never).perRun,
    }));
    // eslint-disable-next-line no-console
    console.log(
      'R&O PRICE SURFACES:\n' +
        JSON.stringify(
          { aov: p.avgTransactionValue, per_txn: c.perTxn, projected_mo: mp.total, byNode: mp.byNode, flowRuns },
          null,
          2,
        ),
    );
    // The engine must produce real prices for R&O:
    expect(c.hasTxn).toBe(true);
    expect(c.perTxn).toBeGreaterThan(0);
    expect(mp.total).toBeGreaterThan(0);
    // and at least one flow must carry a per-run toll (paid path exists).
    expect(flowRuns.some((f: { perRun: number }) => f.perRun > 0)).toBe(true);
  });
});
