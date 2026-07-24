import { useMemo } from 'react';
import { useStudio } from '../store';
import { flowCost } from '../model/opCost';

export function FlowPanel() {
  const project = useStudio((s) => s.project);
  const activeFlow = useStudio((s) => s.activeFlow);
  const driverValues = useStudio((s) => s.driverValues);
  const sel = useStudio((s) => s.sel);
  const setActiveFlow = useStudio((s) => s.setActiveFlow);
  const selectNode = useStudio((s) => s.selectNode);

  const flows = project.flows ?? [];
  const activeFlowObj = flows.find((f) => f.id === activeFlow);
  const flowCostResult = useMemo(
    () => (activeFlowObj ? flowCost(project, activeFlowObj, driverValues) : null),
    [project, activeFlowObj, driverValues],
  );
  const selId = sel?.kind === 'node' ? sel.id : undefined;

  return (
    <>
      <div className="sec flowbtns">
        {flows.map((f) => (
          <button
            key={f.id}
            className={f.id === activeFlow ? 'active' : ''}
            onClick={() => setActiveFlow(f.id)}
          >
            {f.name}
          </button>
        ))}
        <button className={!activeFlow ? 'active' : ''} onClick={() => setActiveFlow(undefined)}>
          None
        </button>
      </div>
      {flowCostResult && (
        <div className="sec flowcost">
          <div className="row">
            <span>cost / run</span>
            <span className="v">
              {flowCostResult.currency} {flowCostResult.perRun.toFixed(2)}
            </span>
          </div>
          {flowCostResult.monthlyTotal != null && (
            <div className="row">
              <span>× {Math.round(flowCostResult.runsPerMonth ?? 0).toLocaleString()}/mo</span>
              <span className="v">
                {flowCostResult.currency} {flowCostResult.monthlyTotal.toFixed(0)}
              </span>
            </div>
          )}
          <div className="breakdown">
            {flowCostResult.steps.map((s, i) => {
              const free = s.contributed <= 0;
              return (
                <div
                  className={`cliff clickable${selId === s.nodeId ? ' sel' : ''}`}
                  key={`${s.nodeId}-${i}`}
                  onClick={() => selectNode(s.nodeId)}
                >
                  <span className={free ? 'muted' : undefined}>
                    {s.name}
                    {s.branch ? ` · ${s.branch}` : ''}
                  </span>
                  <span className="binding">
                    {free ? 'free' : `+${flowCostResult.currency} ${s.contributed.toFixed(2)}`}
                    {'  Σ '}
                    {s.cumulative.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          {flowCostResult.notes.map((n, i) => (
            <div className="about" key={i}>
              {n}
            </div>
          ))}
          <div className="about">Toll accrues along the traced path · click a stop to inspect it.</div>
        </div>
      )}
    </>
  );
}
