import type { NodeKind, ZoneKind, EdgeKind } from '@model/types';

/**
 * The city's visual language. These are exhaustive Records over the model
 * enums, so if a `kind` is ever added to the contract, TypeScript fails here
 * until we give it a look — the type system guards the renderer against drift.
 */

export type Shape = 'tower' | 'slab' | 'silo' | 'gate' | 'crystal' | 'beacon' | 'marker';

interface KindVisual {
  color: string;
  shape: Shape;
  /** Base height in world units. */
  base: number;
}

export const KIND_VISUAL: Record<NodeKind, KindVisual> = {
  client_app: { color: '#7dd3fc', shape: 'slab', base: 2.2 },
  edge_cdn: { color: '#38bdf8', shape: 'slab', base: 1.6 },
  api_gateway: { color: '#2dd4bf', shape: 'gate', base: 2.8 },
  load_balancer: { color: '#5eead4', shape: 'gate', base: 2.4 },
  compute_service: { color: '#60a5fa', shape: 'tower', base: 3.4 },
  container_platform: { color: '#818cf8', shape: 'tower', base: 3.8 },
  serverless_function: { color: '#93c5fd', shape: 'tower', base: 2.6 },
  relational_db: { color: '#a78bfa', shape: 'silo', base: 3.0 },
  nosql_db: { color: '#c084fc', shape: 'silo', base: 3.0 },
  cache: { color: '#fbbf24', shape: 'crystal', base: 1.9 },
  object_store: { color: '#86efac', shape: 'slab', base: 2.0 },
  search_index: { color: '#34d399', shape: 'crystal', base: 2.4 },
  data_warehouse: { color: '#a3e635', shape: 'silo', base: 3.6 },
  data_entity: { color: '#d8b4fe', shape: 'marker', base: 1.0 },
  queue_stream: { color: '#fb923c', shape: 'slab', base: 1.7 },
  stream_processor: { color: '#f97316', shape: 'tower', base: 2.8 },
  cdc_pipeline: { color: '#fdba74', shape: 'slab', base: 1.9 },
  ml_platform: { color: '#f472b6', shape: 'crystal', base: 3.0 },
  auth_identity: { color: '#4ade80', shape: 'gate', base: 2.6 },
  secrets_config: { color: '#22d3ee', shape: 'crystal', base: 1.7 },
  observability: { color: '#f87171', shape: 'beacon', base: 4.0 },
  cicd_deploy: { color: '#fca5a5', shape: 'tower', base: 2.4 },
  digital_twin: { color: '#67e8f9', shape: 'crystal', base: 2.3 },
  actor: { color: '#e2e8f0', shape: 'marker', base: 1.5 },
  external_system: { color: '#94a3b8', shape: 'marker', base: 2.2 },
  other: { color: '#cbd5e1', shape: 'tower', base: 2.2 },
};

export const ZONE_VISUAL: Record<ZoneKind, { color: string; accent: string; overlay: boolean }> = {
  public_edge: { color: '#0c1f33', accent: '#38bdf8', overlay: false },
  authenticated_zone: { color: '#0c231c', accent: '#34d399', overlay: false },
  private_data_plane: { color: '#1a0f2b', accent: '#a78bfa', overlay: false },
  third_party_boundary: { color: '#241705', accent: '#fbbf24', overlay: false },
  compliance_scope: { color: '#2a0912', accent: '#fb7185', overlay: true },
  tenant_isolation: { color: '#241d05', accent: '#eab308', overlay: true },
  other: { color: '#141a26', accent: '#94a3b8', overlay: false },
};

export const EDGE_COLOR: Record<EdgeKind, string> = {
  sync_request: '#93c5fd',
  rpc: '#a5b4fc',
  async_event: '#fca5a5',
  pub_sub: '#f9a8d4',
  stream: '#fdba74',
  webhook_callback: '#fcd34d',
  db_query: '#c4b5fd',
  cache_rw: '#fde68a',
  replication: '#67e8f9',
  batch_job: '#bef264',
  scheduled_trigger: '#a7f3d0',
  persistent_session: '#5eead4',
  contains: '#475569',
  depends_on: '#64748b',
  other: '#94a3b8',
};

/** Zone kinds that place a node into a ground district (vs. cross-cutting overlays). */
export const CONTAINMENT_ZONE_KINDS: ZoneKind[] = [
  'public_edge',
  'authenticated_zone',
  'private_data_plane',
  'third_party_boundary',
];

/** Zone kinds rendered as cross-cutting overlay hulls (not placement districts). */
export const OVERLAY_ZONE_KINDS: ZoneKind[] = ['compliance_scope', 'tenant_isolation'];

/** Distinct, calm hues assigned per overlay scope (by order) so they're
 *  visually separable — rose, sky, violet, amber, green, pink. */
export const OVERLAY_PALETTE = ['#fb7185', '#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f472b6'];
