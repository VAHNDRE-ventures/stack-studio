import { MODEL_VERSION } from '@model/types';
import type {
  Project,
  Node,
  Edge,
  Zone,
  Flow,
  FlowStep,
  NodeKind,
  EdgeKind,
  Ownership,
  BuildState,
  CostModel,
  ZoneKind,
  Id,
} from '@model/types';

/* ---- legacy schema (StackStudio v1) shapes ---------------------------- */
interface LegacyConn {
  targetId: string | number;
  type?: string;
  label?: string;
}
interface LegacyCost {
  currency?: string;
  period?: 'month' | 'year';
  fixedCost?: number;
  fixedCostDescription?: string;
  variableCost?: number;
  variableUnit?: string;
  percentageCost?: number;
  percentageFixed?: number;
  notes?: string;
}
interface LegacyLayer {
  id: string | number;
  name: string;
  type?: string;
  status?: string;
  technology?: string;
  description?: string;
  responsibilities?: string;
  group?: string;
  connections?: (LegacyConn | string | number)[];
  costModel?: LegacyCost;
  substacks?: LegacyLayer[];
}
interface LegacyAction {
  id: string;
  name: string;
  description?: string;
  layersInvolved?: (string | number)[];
  avgCallsPerLayer?: Record<string, number>;
  notes?: string;
  actionCost?: { usageAssumptions?: { estimatedCallsPerMonth?: number } };
}
interface LegacyProject {
  name?: string;
  avgTransactionValue?: number;
  layers?: LegacyLayer[];
  usePaths?: LegacyAction[];
  groupOrder?: string[];
}

export function isLegacyProject(o: unknown): boolean {
  return typeof o === 'object' && o !== null && Array.isArray((o as { layers?: unknown }).layers);
}

/* ---- heuristics ------------------------------------------------------- */

const BASE_KIND: Record<string, NodeKind> = {
  Core: 'compute_service',
  Frontend: 'client_app',
  Backend: 'compute_service',
  Database: 'nosql_db',
  DevOps: 'cicd_deploy',
  API: 'api_gateway',
  Actor: 'actor',
  External: 'external_system',
  Other: 'other',
};

const PROCESSORS = ['paypal', 'stripe', 'coinbase', 'easypost', 'resend', 'twilio', 'sendgrid', 'braintree', 'legitscript', 'acquir'];
const MANAGED = ['cloudflare', 'sanity', 'vercel', 'netlify', 'supabase', 'auth0', 'firebase', 'aws', 'gcp', 'azure', 'planetscale', 'neon', 'upstash'];

/** Refine the coarse legacy type into a precise v2 kind using name + technology. */
function mapKind(layer: LegacyLayer, isChild: boolean): NodeKind {
  const hay = `${layer.name} ${layer.technology ?? ''}`.toLowerCase();
  const base = BASE_KIND[layer.type ?? 'Other'] ?? 'other';

  // A child described as a document/record inside a store is a data entity (a room).
  if (isChild && /(document|record|schema|collection|table|entity|\bdoc\b|asset)/.test(hay)) return 'data_entity';

  if (/\b(kv|redis|memcache|cache)\b/.test(hay)) return 'cache';
  if (/(cdn|pages|edge|cloudfront|fastly)/.test(hay)) return 'edge_cdn';
  if (/(worker|lambda|serverless|function|cron|scheduler)/.test(hay)) return 'serverless_function';
  if (/(queue|kafka|sqs|kinesis|pub\/?sub|event bus|stream|mqtt)/.test(hay)) return 'queue_stream';
  if (/(postgres|mysql|mariadb|\bsql\b|rds|aurora)/.test(hay)) return 'relational_db';
  if (/(sanity|mongo|dynamo|firestore|couch|content lake|document)/.test(hay)) return 'nosql_db';
  if (/(s3|bucket|object store|blob|\br2\b|assets?)/.test(hay)) return 'object_store';
  if (/(search|elastic|opensearch|algolia|pinot|solr)/.test(hay)) return 'search_index';
  if (/(auth|access|identity|turnstile|\bwaf\b|oauth|oidc|jwt|login|otp)/.test(hay)) return 'auth_identity';
  if (/(secret|vault|kms|\bssm\b|config store)/.test(hay)) return 'secrets_config';
  if (/(monitor|observ|analytics|alert|metrics|logging|sentry|datadog)/.test(hay)) return 'observability';
  if (/(warehouse|redshift|bigquery|snowflake|data lake|hadoop|spark)/.test(hay)) return 'data_warehouse';
  if (/(gateway|api gw|ingress|kong|apigee)/.test(hay)) return 'api_gateway';
  if (PROCESSORS.some((p) => hay.includes(p))) return 'external_system';

  return base;
}

function mapOwnership(kind: NodeKind, layer: LegacyLayer): Ownership {
  if (kind === 'actor') return 'external';
  const hay = `${layer.name} ${layer.technology ?? ''}`.toLowerCase();
  if (PROCESSORS.some((p) => hay.includes(p)) || layer.type === 'External') return 'thirdParty';
  if (MANAGED.some((m) => hay.includes(m))) return 'managed';
  return 'owned';
}

function mapBuildState(status?: string): BuildState {
  switch (status) {
    case 'Planned':
      return 'planned';
    case 'Proposed':
      return 'proposed';
    case 'Deprecated':
    case 'Inactive':
      return 'deprecated';
    default:
      return 'active';
  }
}

const EDGE_KIND: Record<string, EdgeKind> = {
  HTTP: 'sync_request',
  Sync: 'sync_request',
  gRPC: 'rpc',
  Event: 'async_event',
  Async: 'async_event',
  Message: 'async_event',
  Database: 'db_query',
  Cache: 'cache_rw',
};

function mapCost(c?: LegacyCost): CostModel | undefined {
  if (!c) return undefined;
  const cost: CostModel = {
    currency: (c.currency as CostModel['currency']) ?? 'USD',
    notes: c.notes,
  };
  if (c.fixedCost) {
    cost.fixedCost = c.fixedCost;
    cost.fixedPeriod = c.period ?? 'month';
    cost.fixedCostDescription = c.fixedCostDescription;
  }
  if (c.variableCost) {
    cost.meters = [
      {
        unit: c.variableUnit ?? 'per-use',
        tiers: [{ name: 'Metered', upTo: null, unitCost: c.variableCost }],
      },
    ];
  }
  if (c.percentageCost || c.percentageFixed) {
    cost.transactionFees = [{ percent: c.percentageCost, fixed: c.percentageFixed }];
  }
  return cost;
}

/* ---- import ----------------------------------------------------------- */

export function importLegacy(legacy: LegacyProject): Project {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const zones: Zone[] = [];
  const seenGroups = new Set<string>();

  const convert = (layer: LegacyLayer, isChild: boolean): Node => {
    const kind = mapKind(layer, isChild);
    const node: Node = {
      id: String(layer.id),
      name: layer.name,
      kind,
      ownership: mapOwnership(kind, layer),
      buildState: mapBuildState(layer.status),
      technology: layer.technology,
      description: layer.description,
      responsibilities: layer.responsibilities,
    };

    // Legacy `group` (Flow lanes) -> zones (the closest legacy analog to zones).
    if (layer.group) {
      node.zoneIds = [`zone-${layer.group}`];
      if (!seenGroups.has(layer.group)) {
        seenGroups.add(layer.group);
        zones.push({ id: `zone-${layer.group}`, name: layer.group, kind: 'other' as ZoneKind });
      }
    }

    const cost = mapCost(layer.costModel);
    if (cost) node.cost = cost;

    // connections -> edges (global ids; endpoints resolved after flatten)
    for (const raw of layer.connections ?? []) {
      const conn: LegacyConn = typeof raw === 'object' ? raw : { targetId: raw };
      edges.push({
        id: `${layer.id}->${conn.targetId}`,
        source: String(layer.id),
        target: String(conn.targetId),
        kind: EDGE_KIND[conn.type ?? 'HTTP'] ?? 'sync_request',
        label: conn.label,
      });
    }

    if (layer.substacks?.length) {
      node.children = layer.substacks.map((s) => convert(s, true));
    }
    return node;
  };

  for (const layer of legacy.layers ?? []) nodes.push(convert(layer, false));

  // usePaths -> flows: match consecutive involved layers to real edges.
  const edgeByPair = new Map<string, Id>();
  for (const e of edges) edgeByPair.set(`${e.source}|${e.target}`, e.id);
  const flows: Flow[] = (legacy.usePaths ?? []).map((a) => {
    const steps: FlowStep[] = [];
    const involved = (a.layersInvolved ?? []).map((x) => String(x));
    let order = 1;
    for (let i = 0; i < involved.length - 1; i++) {
      const eid =
        edgeByPair.get(`${involved[i]}|${involved[i + 1]}`) ??
        edgeByPair.get(`${involved[i + 1]}|${involved[i]}`);
      if (eid) {
        steps.push({ id: `${a.id}-s${i}`, edgeId: eid, order: order++ });
      }
    }
    const flow: Flow = { id: a.id, name: a.name, description: a.description, steps };
    const runs = a.actionCost?.usageAssumptions?.estimatedCallsPerMonth;
    if (runs) flow.volume = { runsPerPeriod: runs, period: 'month' };
    return flow;
  });

  return {
    modelVersion: MODEL_VERSION,
    name: legacy.name ?? 'Imported Project',
    avgTransactionValue: legacy.avgTransactionValue,
    nodes,
    edges,
    zones: zones.length ? zones : undefined,
    flows: flows.length ? flows : undefined,
    meta: { importedFrom: 'legacy-stackstudio' },
  };
}
