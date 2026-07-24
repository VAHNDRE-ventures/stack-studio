import { useMemo } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type { Node } from '@model/types';
import { useStudio } from '../store';
import { nodeCongestion, heatColor } from '../model/load';
import { crossing } from '../model/usage';
import { buildPressureModal } from './modals';

export function BottomDock() {
  const project = useStudio((s) => s.project);
  const driverValues = useStudio((s) => s.driverValues);
  const setDriver = useStudio((s) => s.setDriver);
  const resetDrivers = useStudio((s) => s.resetDrivers);
  const setModal = useStudio((s) => s.setModal);
  const allowScenario = useStudio((s) => s.allowScenario);
  const dockOpen = useStudio((s) => s.dockOpen);
  const toggleDock = useStudio((s) => s.toggleDock);

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

  if (driverKeys.length === 0) return null;

  return (
    <div className={`bottom-dock${dockOpen ? ' open' : ''}`}>
      <button type="button" className="dock-handle" onClick={toggleDock}>
        <SlidersHorizontal size={14} strokeWidth={2} />
        <span>Load drivers</span>
        {pressure.length > 0 && <span className="dock-badge">{pressure.length}</span>}
        {dockOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {dockOpen && (
        <div className="dock-body hud">
          <div className="dock-drivers">
            {driverKeys.map((key) => {
              const val = driverValues[key] ?? 0;
              const base = project.drivers?.[key] ?? val ?? 1;
              const max = Math.max(base * 4, 10);
              return (
                <div className="dock-driver" key={key}>
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
            {allowScenario && (
              <button className="dock-reset" type="button" onClick={() => resetDrivers()} title="Reset to baseline">
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
            )}
          </div>

          {pressure.length > 0 && (
            <div className="dock-pressure">
              <span className="dock-pressure-label">Pressure</span>
              {pressure.map((p) => (
                <button
                  type="button"
                  className="pressure-chip"
                  key={p.node.id}
                  onClick={() => setModal(buildPressureModal(p.node, driverValues, 1, horizon))}
                  title={p.node.name}
                >
                  <i style={{ background: heatColor(p.ratio) ?? '#f9e2af' }} />
                  <span className="pc-name">{p.node.name}</span>
                  <span className="pc-val">
                    {p.node.capacity?.usage?.model === 'cumulative'
                      ? (crossing(p.node, driverValues, p.node.capacity?.ceiling ?? 0, 1, horizon)?.text ??
                        `${Math.round(p.ratio * 100)}%`)
                      : `${Math.round(p.ratio * 100)}%`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
