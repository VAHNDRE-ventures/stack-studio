import type { Project, Node, Id } from '@model/types';

/**
 * Resolve which nodes become buildings vs. rooms.
 *
 * The composition-vs-graph problem (the #1 thing the legacy R&O diagram got
 * wrong): a store's `data_entity` children are *rooms inside the building*, not
 * separate buildings — while real architectural substacks (Workers, KV, Cron…)
 * ARE buildings. So we place every node EXCEPT `data_entity`, and remap any
 * edge endpoint that lands on a data_entity to its nearest placed ancestor, so
 * connections that were authored against a nested node still render.
 */
export interface Placed {
  nodes: Node[];
  /** placed node id -> number of data_entity children (the "▸ N entities" badge) */
  dataCount: Record<Id, number>;
  /** any node id -> the placed node that represents it */
  remap: Record<Id, Id>;
}

export function collectPlaced(project: Project): Placed {
  const nodes: Node[] = [];
  const dataCount: Record<Id, number> = {};
  const remap: Record<Id, Id> = {};

  const walk = (n: Node, inheritZones: Id[] | undefined, nearestPlaced: Id | null) => {
    if (n.kind === 'data_entity') {
      const anchor = nearestPlaced ?? n.id;
      remap[n.id] = anchor;
      for (const c of n.children ?? []) walk(c, inheritZones, anchor);
      return;
    }
    // A placed node inherits its parent's zones if it declares none of its own.
    const zoneIds = n.zoneIds && n.zoneIds.length ? n.zoneIds : inheritZones;
    nodes.push(zoneIds === n.zoneIds ? n : { ...n, zoneIds });
    remap[n.id] = n.id;
    const kids = n.children ?? [];
    dataCount[n.id] = kids.filter((c) => c.kind === 'data_entity').length;
    for (const c of kids) walk(c, zoneIds, n.id);
  };

  for (const n of project.nodes) walk(n, undefined, null);
  return { nodes, dataCount, remap };
}
