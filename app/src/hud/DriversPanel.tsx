import { useMemo } from 'react';
import type { Node } from '@model/types';
import { useStudio } from '../store';
import { nodeCongestion, heatColor } from '../model/load';
import { crossing } from '../model/usage';
import { buildPressureModal } from './modals';

export function DriversPanel() {
  const project = useStudio((s) => s.project);
  const driverValues = useStudio((s) => s.driverValues);
  const setDriver = useStudio((s) => s.setDriver);
  const resetDrivers = useStudio((s) => s.resetDrivers);
  const setModal = useStudio((s) => s.setModal);
  const allowScenario = useStudio((s) => s.allowScenario);

  const horizon = project.horizonMonths ?? 12;
  const driverKeys = Object.keys(driverValues);
  const pressure = useMemo(() => {
    const out: { node: Node; ratio: number }[] = [];
    const walk = (n: Node) => {
      const r = nodeCongestion(n, driverValues, 1, horizon);
      if (r !== undefined && r >= 0.8) out.push({ node: n, ratio: r });
      (n.children ?? []).forEach(walk);
    };
    project.nodes.forEach(walk);
    return out.sort((a, b) => b.ratio - a.ratio);
  }, [project, driverValues, horizon]);

  return (
    <details open>
      <summary>Load drivers</summary>
      <div className="sec">
        {driverKeys.length === 0 && (
          <div className="about">No load drivers defined in this project.</div>
        )}
        {driverKeys.map((key) => {
          const val = driverValues[key] ?? 0;
          const base = project.drivers?.[key] ?? val ?? 1;
          const max = Math.max(base * 4, 10);
          return (
            <div className="driver" key={key}>
              <div className="row">
                <span>{key}</span>
                <span className="v">{val.toLocaleString()}/mo</span>
              </div>
              {allowScenario && (
                <input
                  type="range"
                  min={0}
                  max={max}
                  step={Math.max(1, Math.round(base / 20))}
                  value={val}
                  onChange={(e) => setDriver(key, Number(e.target.value))}
                />
              )}
            </div>
          );
        })}
        {allowScenario && driverKeys.length > 0 && (
          <button className="linkbtn" onClick={() => resetDrivers()}>
            Reset to baseline
          </button>
        )}
        <div className="about">
          Set each driver to its real monthly baseline — congestion and cost cliffs recompute from
          these values.
        </div>

        {pressure.length > 0 ? (
          <>
            <div className="note">Pressure points</div>
            {pressure.map((p) => (
              <div
                className="cliff clickable"
                key={p.node.id}
                onClick={() => setModal(buildPressureModal(p.node, driverValues, 1, horizon))}
              >
                <span>
                  <i style={{ background: heatColor(p.ratio) ?? '#f9e2af' }} />
                  {p.node.name}
                </span>
                <span className="binding">
                  {p.node.capacity?.usage?.model === 'cumulative'
                    ? (crossing(p.node, driverValues, p.node.capacity?.ceiling ?? 0, 1, horizon)?.text ??
                      `${Math.round(p.ratio * 100)}%`)
                    : `${Math.round(p.ratio * 100)}% of capacity`}
                </span>
              </div>
            ))}
          </>
        ) : (
          <div className="note">No pressure points at this baseline.</div>
        )}
      </div>
    </details>
  );
}
