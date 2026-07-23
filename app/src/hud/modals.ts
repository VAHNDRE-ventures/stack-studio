import type { Project, Node, Zone } from '@model/types';
import type { CatalogCliff } from '../model/costForesight';
import { RATE_CATALOG } from '../model/rateCatalog';
import { projectedUsage, crossing } from '../model/usage';
import type { ModalData } from '../store';

const rateByKey = new Map(RATE_CATALOG.map((e) => [e.key, e]));

export function buildCliffModal(cl: CatalogCliff): ModalData {
  const e = rateByKey.get(cl.key);
  const rows: [string, string][] = [];
  if (e?.freeAllowance) {
    rows.push([
      'Free allowance',
      `${e.freeAllowance.amount.toLocaleString()} ${e.freeAllowance.unit}/${e.freeAllowance.per}`,
    ]);
  }
  rows.push(['Binding constraint', cl.binding]);
  rows.push(['Crossing', cl.crossText ?? 'no usage model set — add capacity.usage to project it']);
  if (e?.monthlyFloor) rows.push(['Paid floor', `$${e.monthlyFloor}/mo`]);
  if (e?.transaction) {
    rows.push([
      'Per-txn fee',
      `${e.transaction.percent ?? 0}%${e.transaction.fixed ? ` + $${e.transaction.fixed}` : ''}`,
    ]);
  }
  return {
    title: e?.label ?? cl.label,
    note: '"Over free tier" means projected usage exceeds the provider\u2019s free allowance, tipping this component into paid pricing.',
    rows,
    source: e ? `${e.source} \u00b7 ${e.lastVerified}` : undefined,
  };
}

export function buildPressureModal(
  node: Node,
  drivers: Record<string, number>,
  load: number,
  horizon: number,
): ModalData {
  const cap = node.capacity;
  const model = cap?.usage?.model;
  const u = projectedUsage(node, drivers, load, horizon);
  const unit = cap?.unit ?? '';
  const per = cap?.per ? `/${cap.per}` : '';
  const ceiling = cap?.ceiling ?? 0;
  const rows: [string, string][] = [];
  let note = 'Pressure means projected load is nearing or over this component\u2019s capacity ceiling.';

  if (model === 'cumulative') {
    const rate = u?.value ?? 0;
    const total = rate * horizon;
    const cr = crossing(node, drivers, ceiling, load, horizon);
    note =
      'A store that accumulates over time: load scales the fill RATE; the ceiling is a running total, not a monthly rate. The real signal is time-to-fill.';
    rows.push(['Metered', `${unit} (running total)`]);
    rows.push(['Ceiling', `${ceiling.toLocaleString()} ${unit}`]);
    rows.push([`Fill rate`, `~${Math.round(rate).toLocaleString()} ${unit}/mo`]);
    if (cr) rows.push(['Fills', cr.text.replace('fills in ~', '~')]);
    rows.push([
      `Over ${horizon} mo`,
      `${Math.round(total).toLocaleString()} ${unit} (${Math.round((total / (ceiling || 1)) * 100)}% of cap)`,
    ]);
  } else if (model === 'operational') {
    note = 'Operational: fixed usage, independent of customer load.';
    rows.push(['Metered', `${unit}${per}`]);
    rows.push(['Ceiling', `${ceiling.toLocaleString()} ${unit}${per}`]);
    rows.push(['Fixed', `${Math.round(u?.value ?? 0).toLocaleString()} ${unit}${per}`]);
  } else {
    const cr = crossing(node, drivers, ceiling, load, horizon);
    rows.push(['Metered', `${unit}${per}`]);
    rows.push(['Ceiling', `${ceiling.toLocaleString()} ${unit}${per}`]);
    rows.push([
      `Usage`,
      u ? `${Math.round(u.value).toLocaleString()} ${unit} \u00b7 ${Math.round((u.ratio ?? 0) * 100)}%` : '\u2014',
    ]);
    if (cr) rows.push(['Crossing', cr.text]);
  }
  return { title: node.name, note, rows };
}

function overlayNote(z: Zone): string {
  if (z.description) return z.description;
  const s = `${z.subtype ?? ''} ${z.name}`.toLowerCase();
  if (/(pci|processor|payment)/.test(s))
    return 'Payment-sensitive scope: the minimal set of components that touch card/checkout data. Kept deliberately small so a processor review has little to see.';
  if (/(pii|shipping|address)/.test(s))
    return 'PII / shipping scope: components that handle personally-identifiable or address data — the surface a privacy review cares about.';
  if (/(consent|policy)/.test(s))
    return 'Policy / consent scope: the audit trail of what customers agreed to and when — evidence for disputes and compliance.';
  if (/(tenant)/.test(s))
    return 'Tenant-isolation scope: the components partitioned per tenant to bound one tenant\u2019s blast radius.';
  return 'A cross-cutting scope: components grouped by a shared data-sensitivity concern that spans the trust zones.';
}

export function buildOverlayModal(project: Project, zone: Zone): ModalData {
  const members: [string, string][] = [];
  const walk = (n: Node) => {
    if ((n.zoneIds ?? []).includes(zone.id)) members.push([n.name, n.kind]);
    (n.children ?? []).forEach(walk);
  };
  project.nodes.forEach(walk);
  return {
    title: zone.name,
    note: overlayNote(zone),
    rows: members.length ? members : [['members', 'none']],
  };
}
