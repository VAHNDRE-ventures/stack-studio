import type {
  Project,
  Node,
  NodeKind,
  EdgeKind,
  ZoneKind,
  Ownership,
  BuildState,
  Id,
} from '@model/types';

// Typed literal lists — tsc fails here if any value drifts from the contract.
const NODE_KINDS: NodeKind[] = [
  'client_app', 'edge_cdn', 'api_gateway', 'load_balancer', 'compute_service',
  'container_platform', 'serverless_function', 'relational_db', 'nosql_db', 'cache',
  'object_store', 'search_index', 'data_warehouse', 'data_entity', 'queue_stream',
  'stream_processor', 'cdc_pipeline', 'ml_platform', 'auth_identity', 'secrets_config',
  'observability', 'cicd_deploy', 'digital_twin', 'actor', 'external_system', 'other',
];
const EDGE_KINDS: EdgeKind[] = [
  'sync_request', 'rpc', 'async_event', 'pub_sub', 'stream', 'webhook_callback',
  'db_query', 'cache_rw', 'replication', 'batch_job', 'scheduled_trigger',
  'persistent_session', 'contains', 'depends_on', 'other',
];
const ZONE_KINDS: ZoneKind[] = [
  'public_edge', 'authenticated_zone', 'private_data_plane', 'compliance_scope',
  'tenant_isolation', 'third_party_boundary', 'other',
];
const OWNERSHIPS: Ownership[] = ['owned', 'managed', 'thirdParty', 'external'];
const BUILD_STATES: BuildState[] = [
  'proposed', 'planned', 'in_progress', 'active', 'deprecated', 'retired',
];

const nodeKinds = new Set<string>(NODE_KINDS);
const edgeKinds = new Set<string>(EDGE_KINDS);
const zoneKinds = new Set<string>(ZONE_KINDS);
const ownerships = new Set<string>(OWNERSHIPS);
const buildStates = new Set<string>(BUILD_STATES);

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateProject(p: Project): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!p || typeof p !== 'object') {
    errors.push('Project is not an object');
    return { errors, warnings };
  }
  if (p.modelVersion !== '2.0.0') warnings.push(`modelVersion is '${p.modelVersion}', expected '2.0.0'`);
  if (!Array.isArray(p.nodes)) errors.push('nodes[] is missing');
  if (!Array.isArray(p.edges)) errors.push('edges[] is missing');
  if (errors.length) return { errors, warnings };

  const nodeIds = new Set<Id>();
  const walk = (n: Node, path: string) => {
    if (n.id === undefined || n.id === null) errors.push(`${path}: node missing id`);
    else if (nodeIds.has(n.id)) errors.push(`duplicate node id '${n.id}'`);
    else nodeIds.add(n.id);
    if (!n.name) warnings.push(`node '${n.id}': missing name`);
    if (!nodeKinds.has(n.kind)) errors.push(`node '${n.id}': invalid kind '${n.kind}'`);
    if (n.ownership && !ownerships.has(n.ownership)) errors.push(`node '${n.id}': invalid ownership '${n.ownership}'`);
    if (n.buildState && !buildStates.has(n.buildState)) errors.push(`node '${n.id}': invalid buildState '${n.buildState}'`);
    for (let i = 0; i < (n.children ?? []).length; i++) walk(n.children![i], `${path}.children[${i}]`);
  };
  p.nodes.forEach((n, i) => walk(n, `nodes[${i}]`));

  const zoneIds = new Set<Id>();
  for (const z of p.zones ?? []) {
    if (zoneIds.has(z.id)) errors.push(`duplicate zone id '${z.id}'`);
    zoneIds.add(z.id);
    if (!zoneKinds.has(z.kind)) errors.push(`zone '${z.id}': invalid kind '${z.kind}'`);
  }
  const checkZoneRefs = (n: Node) => {
    for (const zid of n.zoneIds ?? []) {
      if (!zoneIds.has(zid)) warnings.push(`node '${n.id}': zoneId '${zid}' is not defined`);
    }
    for (const c of n.children ?? []) checkZoneRefs(c);
  };
  p.nodes.forEach(checkZoneRefs);

  const edgeIds = new Set<Id>();
  for (const e of p.edges) {
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id '${e.id}'`);
    edgeIds.add(e.id);
    if (!edgeKinds.has(e.kind)) errors.push(`edge '${e.id}': invalid kind '${e.kind}'`);
    if (!nodeIds.has(e.source)) errors.push(`edge '${e.id}': source '${e.source}' is not a node`);
    if (!nodeIds.has(e.target)) errors.push(`edge '${e.id}': target '${e.target}' is not a node`);
  }

  for (const f of p.flows ?? []) {
    for (const s of f.steps ?? []) {
      if (!edgeIds.has(s.edgeId)) errors.push(`flow '${f.id}' step '${s.id}': edgeId '${s.edgeId}' is not an edge`);
    }
  }

  return { errors, warnings };
}
