import { useMemo } from 'react';
import type { Project, Node, Id } from '@model/types';
import { collectPlaced } from './model/flatten';
import { projectedUsage, crossing } from './model/usage';

export interface Selection {
  kind: 'node' | 'edge';
  id: Id;
}

function findNode(nodes: Node[], id: Id): Node | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = n.children ? findNode(n.children, id) : undefined;
    if (c) return c;
  }
  return undefined;
}

interface Section {
  h: string;
  rows: [string, string][];
}

export function InspectorPanel({
  project,
  sel,
  drivers,
  horizon,
  onClose,
}: {
  project: Project;
  sel: Selection;
  drivers: Record<string, number>;
  horizon: number;
  onClose: () => void;
}) {
  const placed = useMemo(() => collectPlaced(project), [project]);
  const nameOf = (id: Id) => findNode(project.nodes, placed.remap[id] ?? id)?.name ?? String(id);
  const zoneName = (id: Id) => (project.zones ?? []).find((z) => z.id === id)?.name ?? String(id);
  const phaseName = (id?: Id) => (project.phases ?? []).find((p) => p.id === id)?.name;

  let title = '';
  let subtitle = '';
  let desc: string | undefined;
  let resp: string | undefined;
  const sections: Section[] = [];

  if (sel.kind === 'node') {
    const n = findNode(project.nodes, sel.id);
    if (!n) return null;
    title = n.name;
    subtitle = n.subtype ? `${n.kind} · ${n.subtype}` : n.kind;
    desc = n.description;
    resp = n.responsibilities;

    const overview: [string, string][] = [
      ['ownership', n.ownership],
      ['build state', n.buildState],
    ];
    if (n.technology) overview.push(['technology', n.technology]);
    if (n.zoneIds?.length) overview.push(['zones', n.zoneIds.map(zoneName).join(', ')]);
    const ph = phaseName(n.phaseId);
    if (ph) overview.push(['phase', ph]);
    sections.push({ h: 'Overview', rows: overview });

    if (n.capacity?.usage) {
      const cap = n.capacity;
      const usage = n.capacity.usage;
      const u = projectedUsage(n, drivers, 1, horizon);
      const cr = crossing(n, drivers, cap.ceiling ?? 0, 1, horizon);
      const rows: [string, string][] = [['model', usage.model]];
      if (usage.driver) rows.push(['driver', `${usage.driver} × ${usage.perUnit ?? 0}`]);
      if (usage.model === 'operational') rows.push(['fixed', `${usage.fixed ?? 0}`]);
      if (cap.ceiling) rows.push(['ceiling', `${cap.ceiling.toLocaleString()} ${cap.unit}${cap.per ? '/' + cap.per : ''}`]);
      if (u) {
        rows.push([
          'now',
          `${Math.round(u.value).toLocaleString()} ${cap.unit}${usage.model === 'cumulative' ? '/mo' : cap.per ? '/' + cap.per : ''} · ${Math.round((u.ratio ?? 0) * 100)}%`,
        ]);
      }
      if (cr) rows.push([usage.model === 'cumulative' ? 'fills' : 'crosses', cr.text]);
      sections.push({ h: 'Capacity', rows });
    }

    if (n.cost) {
      const c = n.cost;
      const rows: [string, string][] = [];
      if (c.fixedCost) rows.push(['fixed', `${c.currency ?? 'USD'} ${c.fixedCost}/${c.fixedPeriod ?? 'month'}`]);
      for (const m of c.meters ?? []) {
        rows.push([
          'meter',
          `${m.unit}${m.freeAllowance ? ` · free ${m.freeAllowance.amount.toLocaleString()}/${m.freeAllowance.per}` : ''}`,
        ]);
      }
      for (const f of c.transactionFees ?? []) {
        rows.push(['per txn', `${f.percent ?? 0}%${f.fixed ? ` + $${f.fixed}` : ''}`]);
      }
      if (c.provider) rows.push(['provider', `${c.provider}${c.lastVerified ? ` · ${c.lastVerified}` : ''}`]);
      if (rows.length) sections.push({ h: 'Cost', rows });
    }

    const ents = (n.children ?? []).filter((c) => c.kind === 'data_entity');
    if (ents.length) {
      sections.push({
        h: `Data entities · ${ents.length}`,
        rows: ents.map((e) => [e.name, e.subtype ?? 'document'] as [string, string]),
      });
    }

    const out = project.edges.filter((e) => (placed.remap[e.source] ?? e.source) === sel.id);
    const inc = project.edges.filter((e) => (placed.remap[e.target] ?? e.target) === sel.id);
    if (out.length) {
      sections.push({
        h: `Outgoing · ${out.length}`,
        rows: out.map((e) => [`→ ${nameOf(e.target)}`, `${e.kind}${e.label ? ` · ${e.label}` : ''}`] as [string, string]),
      });
    }
    if (inc.length) {
      sections.push({
        h: `Incoming · ${inc.length}`,
        rows: inc.map((e) => [`← ${nameOf(e.source)}`, `${e.kind}${e.label ? ` · ${e.label}` : ''}`] as [string, string]),
      });
    }
  } else {
    const e = project.edges.find((x) => x.id === sel.id);
    if (!e) return null;
    title = `${nameOf(e.source)} → ${nameOf(e.target)}`;
    subtitle = e.kind;
    const rows: [string, string][] = [];
    if (e.label) rows.push(['payload', e.label]);
    if (e.direction) rows.push(['direction', e.direction]);
    if (e.dataClass) rows.push(['data class', e.dataClass]);
    if (e.zoneCrossing) rows.push(['trust boundary', 'crosses']);
    sections.push({ h: 'Connection', rows });

    if (e.reliability) {
      const r = e.reliability;
      const rr: [string, string][] = [];
      if (r.idempotent !== undefined) rr.push(['idempotent', r.idempotent ? 'yes' : 'no']);
      if (r.retry) rr.push(['retry', `${r.retry.strategy}${r.retry.maxWindow ? ` · ${r.retry.maxWindow}` : ''}`]);
      if (r.deliveryGuarantee) rr.push(['delivery', r.deliveryGuarantee]);
      if (r.backpressure !== undefined) rr.push(['backpressure', r.backpressure ? 'yes' : 'no']);
      if (rr.length) sections.push({ h: 'Reliability', rows: rr });
    }
  }

  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="insp-title">
          <h1>{title}</h1>
          <div className="insp-sub">{subtitle}</div>
        </div>
        <button onClick={onClose}>×</button>
      </div>
      <div className="hud-scroll">
        {desc && <div className="insp-desc">{desc}</div>}
        {resp && <div className="insp-desc muted">{resp}</div>}
        {sections.map((s) => (
          <div className="insp-sec" key={s.h}>
            <div className="insp-h">{s.h}</div>
            {s.rows.map(([k, v], i) => (
              <div className="modal-row" key={`${k}-${i}`}>
                <span>{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
