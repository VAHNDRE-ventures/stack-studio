import { useMemo } from 'react';
import type { Edge } from '@model/types';
import { collectPlaced } from '../model/flatten';
import { nodeCongestion } from '../model/load';
import { analyzeCost } from '../model/costForesight';
import { projectMonthly, flowCost } from '../model/opCost';
import { useStudio } from '../store';
import { loadFactor, overlayInfo } from './derive';
import { layoutCity } from './layout';
import { routeEdges } from './routing';
import { Building } from './Building';
import { District } from './District';
import { Road } from './Road';
import { ComplianceHull } from './ComplianceHull';
import { Traffic } from './Traffic';
import { FlowCostTicker } from './FlowCostTicker';

export function CityScene() {
  const project = useStudio((s) => s.project);
  const activeFlowId = useStudio((s) => s.activeFlow);
  const drivers = useStudio((s) => s.driverValues);
  const phaseCutoff = useStudio((s) => s.phaseCutoff);
  const blastPhaseId = useStudio((s) => s.blastPhase);
  const selRaw = useStudio((s) => s.sel);
  const activeOverlayId = useStudio((s) => s.activeOverlay);
  const costFocus = useStudio((s) => s.costFocus);
  const onSelectNode = useStudio((s) => s.selectNode);
  const onSelectEdge = useStudio((s) => s.selectEdge);
  const selected = selRaw ?? undefined;

  const intensity = useMemo(() => loadFactor(project, drivers), [project, drivers]);
  const overlayColor = useMemo(
    () => (activeOverlayId ? overlayInfo(project).colorOf[activeOverlayId] : undefined),
    [project, activeOverlayId],
  );
  const costFocusIds = useMemo(() => {
    if (!costFocus) return undefined;
    if (costFocus === 'monthly')
      return new Set(projectMonthly(project, drivers).byNode.map((c) => c.nodeId));
    const cost = analyzeCost(project, drivers);
    return new Set(
      (costFocus === 'fixed' ? cost.fixedContribs : cost.txnContribs).map((c) => c.nodeId),
    );
  }, [project, drivers, costFocus]);
  const flowCostResult = useMemo(() => {
    const f = project.flows?.find((x) => x.id === activeFlowId);
    return f ? flowCost(project, f, drivers) : null;
  }, [project, activeFlowId, drivers]);
  const flowTolls = useMemo(() => {
    if (!flowCostResult) return undefined;
    const m: Record<string, number> = {};
    for (const s of flowCostResult.steps)
      if (s.contributed > 0) m[s.nodeId] = (m[s.nodeId] ?? 0) + s.contributed;
    return m;
  }, [flowCostResult]);

  const placed = useMemo(() => collectPlaced(project), [project]);
  const layout = useMemo(
    () => layoutCity(placed.nodes, project.zones ?? []),
    [placed, project.zones],
  );
  const congestion = useMemo(() => {
    const dv = drivers ?? project.drivers ?? {};
    const horizon = project.horizonMonths ?? 12;
    const m: Record<string, number | undefined> = {};
    for (const n of placed.nodes) m[n.id] = nodeCongestion(n, dv, 1, horizon);
    return m;
  }, [placed, drivers, project.drivers, project.horizonMonths]);

  // Remap edge endpoints to their placed node (data_entity → its store), drop
  // self-loops and edges whose endpoints didn't get placed.
  const renderEdges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (const e of project.edges) {
      const source = placed.remap[e.source] ?? e.source;
      const target = placed.remap[e.target] ?? e.target;
      if (source === target) continue;
      if (!layout.positions[source] || !layout.positions[target]) continue;
      out.push({ ...e, source, target });
    }
    return out;
  }, [project.edges, placed, layout.positions]);

  const routes = useMemo(
    () => routeEdges(renderEdges, layout.positions),
    [renderEdges, layout.positions],
  );

  const flow = project.flows?.find((f) => f.id === activeFlowId);
  const activeEdges = useMemo(
    () => new Set(flow?.steps.map((s) => s.edgeId) ?? []),
    [flow],
  );

  // Traffic intensity for the active flow = how far ITS driver is pushed above
  // baseline (attaches each flow's density to the driver that produces it);
  // falls back to the global load factor when the flow declares no driver.
  const flowScaling = useMemo(() => {
    if (!flow) return intensity;
    const cur = drivers ?? project.drivers ?? {};
    const base = project.drivers ?? {};
    const d = flow.driver;
    if (d && (base[d] ?? 0) > 0) return (cur[d] ?? 0) / (base[d] as number);
    return intensity;
  }, [flow, drivers, project.drivers, intensity]);

  const phaseOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const ph of project.phases ?? []) m.set(ph.id, ph.order);
    return m;
  }, [project.phases]);
  const maxOrder = useMemo(
    () => Math.max(0, ...(project.phases ?? []).map((p) => p.order)),
    [project.phases],
  );
  const cutoff = phaseCutoff ?? maxOrder;

  // A node is "built" at the current scrub position if its phase is ≤ cutoff
  // (unphased nodes are treated as baseline / always present).
  const built = useMemo(() => {
    const s = new Set<string>();
    for (const n of placed.nodes) {
      const ord = n.phaseId ? (phaseOrder.get(n.phaseId) ?? 0) : 0;
      if (ord <= cutoff) s.add(n.id);
    }
    return s;
  }, [placed, phaseOrder, cutoff]);

  // Blast radius of the focused phase: its nodes + everything reachable forward
  // along the graph (calls / depends_on / contains).
  const blast = useMemo(() => {
    if (!blastPhaseId) return null;
    const start = placed.nodes.filter((n) => n.phaseId === blastPhaseId).map((n) => n.id);
    const adj = new Map<string, string[]>();
    for (const e of renderEdges) {
      const a = adj.get(e.source);
      if (a) a.push(e.target);
      else adj.set(e.source, [e.target]);
    }
    const set = new Set<string>(start);
    const stack = [...start];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const nx of adj.get(cur) ?? []) {
        if (!set.has(nx)) {
          set.add(nx);
          stack.push(nx);
        }
      }
    }
    return set;
  }, [blastPhaseId, placed, renderEdges]);

  const focusNodes = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'node') {
      const s = new Set<string>([selected.id]);
      for (const e of renderEdges) {
        if (e.source === selected.id) s.add(e.target);
        if (e.target === selected.id) s.add(e.source);
      }
      return s;
    }
    const e = renderEdges.find((x) => x.id === selected.id);
    return e ? new Set<string>([e.source, e.target]) : new Set<string>();
  }, [selected, renderEdges]);

  const focusEdges = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'edge') return new Set<string>([selected.id]);
    return new Set<string>(
      renderEdges.filter((e) => e.source === selected.id || e.target === selected.id).map((e) => e.id),
    );
  }, [selected, renderEdges]);

  const overlayMembers = useMemo(() => {
    if (!activeOverlayId) return null;
    const s = new Set<string>();
    for (const n of placed.nodes) if ((n.zoneIds ?? []).includes(activeOverlayId)) s.add(n.id);
    return s;
  }, [activeOverlayId, placed]);

  // One focus set drives highlight-and-dim: selection > overlay > cost group > build phase.
  const keepNodes = focusNodes ?? overlayMembers ?? (costFocusIds ?? null) ?? blast ?? null;

  return (
    <group>
      {layout.districts.map((b) => (
        <District key={b.zoneId} box={b} />
      ))}

      {renderEdges.map((e) => {
        const pts = routes[e.id];
        if (!pts) return null;
        const heat = Math.max(congestion[e.source] ?? 0, congestion[e.target] ?? 0) || undefined;
        const bothBuilt = built.has(e.source) && built.has(e.target);
        const dim =
          !bothBuilt ||
          (focusEdges
            ? !focusEdges.has(e.id)
            : keepNodes
              ? !(keepNodes.has(e.source) && keepNodes.has(e.target))
              : !!flow && !activeEdges.has(e.id));
        return (
          <Road
            key={e.id}
            edge={e}
            points={pts}
            dim={dim}
            heat={bothBuilt ? heat : undefined}
            onSelect={() => onSelectEdge?.(e.id)}
          />
        );
      })}

      {placed.nodes.map((n) => {
        const p = layout.positions[n.id];
        if (!p) return null;
        return (
          <Building
            key={n.id}
            node={n}
            position={p}
            dataCount={placed.dataCount[n.id] ?? 0}
            congestion={congestion[n.id]}
            future={!built.has(n.id)}
            dimmed={keepNodes ? !keepNodes.has(n.id) : false}
            emphasized={keepNodes ? keepNodes.has(n.id) : false}
            toll={flowTolls?.[n.id]}
            onSelect={() => onSelectNode?.(n.id)}
          />
        );
      })}

      {activeOverlayId &&
        layout.overlays
          .filter((b) => b.zoneId === activeOverlayId)
          .map((b) => <ComplianceHull key={b.zoneId} box={b} color={overlayColor ?? '#fb7185'} />)}

      {flow && <Traffic flow={flow} routes={routes} edges={renderEdges} intensity={flowScaling} />}
      {flowCostResult && <FlowCostTicker fc={flowCostResult} routes={routes} />}
    </group>
  );
}
