import { useMemo } from 'react';
import { useStudio } from '../store';
import { analyzeCost } from '../model/costForesight';
import { projectMonthly } from '../model/opCost';
import { buildCliffModal } from './modals';

export function CostPanel() {
  const project = useStudio((s) => s.project);
  const driverValues = useStudio((s) => s.driverValues);
  const costFocus = useStudio((s) => s.costFocus);
  const sel = useStudio((s) => s.sel);
  const toggleCostFocus = useStudio((s) => s.toggleCostFocus);
  const selectNode = useStudio((s) => s.selectNode);
  const setModal = useStudio((s) => s.setModal);

  const cost = useMemo(() => analyzeCost(project, driverValues), [project, driverValues]);
  const monthly = useMemo(() => projectMonthly(project, driverValues), [project, driverValues]);
  const selId = sel?.kind === 'node' ? sel.id : undefined;

  return (
    <details open>
      <summary>Cost foresight</summary>
      <div className="sec">
        <div
          className={`row clickable${costFocus === 'fixed' ? ' sel' : ''}`}
          onClick={() => toggleCostFocus('fixed')}
        >
          <span>fixed / mo</span>
          <span className="v">
            {cost.currency} {cost.monthlyFixed.toFixed(2)}
          </span>
        </div>
        {costFocus === 'fixed' && (
          <div className="breakdown">
            {cost.fixedContribs.length === 0 ? (
              <div className="about">No fixed monthly costs.</div>
            ) : (
              cost.fixedContribs.map((fc) => (
                <div
                  className={`cliff clickable${selId === fc.nodeId ? ' sel' : ''}`}
                  key={fc.nodeId}
                  onClick={() => selectNode(fc.nodeId)}
                >
                  <span>{fc.detail ? `${fc.name} · ${fc.detail}` : fc.name}</span>
                  <span className="binding">
                    {cost.currency} {fc.monthly.toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {cost.hasTxn && (
          <div
            className={`row clickable${costFocus === 'txn' ? ' sel' : ''}`}
            onClick={() => toggleCostFocus('txn')}
          >
            <span>per txn</span>
            <span className="v">
              {cost.currency} {cost.perTxn.toFixed(2)}
            </span>
          </div>
        )}
        {costFocus === 'txn' && (
          <div className="breakdown">
            {cost.txnContribs.length === 0 ? (
              <div className="about">No per-transaction fees.</div>
            ) : (
              cost.txnContribs.map((tc) => (
                <div
                  className={`cliff clickable${selId === tc.nodeId ? ' sel' : ''}`}
                  key={tc.nodeId}
                  onClick={() => selectNode(tc.nodeId)}
                >
                  <span>
                    {tc.name}
                    {tc.percent ? ` · ${tc.percent}%` : ''}
                    {tc.fixed ? ` + ${cost.currency} ${tc.fixed}` : ''}
                  </span>
                  <span className="binding">
                    {cost.currency} {tc.perTxn.toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        <div
          className={`row clickable${costFocus === 'monthly' ? ' sel' : ''}`}
          onClick={() => toggleCostFocus('monthly')}
        >
          <span>projected / mo</span>
          <span className="v">
            {monthly.currency} {monthly.total.toFixed(0)}
          </span>
        </div>
        {costFocus === 'monthly' && (
          <div className="breakdown">
            {monthly.byNode.length === 0 ? (
              <div className="about">No projected costs at this load.</div>
            ) : (
              monthly.byNode.map((mc) => (
                <div
                  className={`cliff clickable${selId === mc.nodeId ? ' sel' : ''}`}
                  key={mc.nodeId}
                  onClick={() => selectNode(mc.nodeId)}
                >
                  <span>{mc.name}</span>
                  <span className="binding">
                    {monthly.currency} {mc.monthly.toFixed(mc.monthly < 10 ? 2 : 0)}
                  </span>
                </div>
              ))
            )}
            <div className="about">At current drivers · scales with the sliders.</div>
          </div>
        )}
        <div className="note">{cost.headline}</div>
        {cost.catalogCliffs.map((cl) => (
          <div className="cliff clickable" key={cl.key} onClick={() => setModal(buildCliffModal(cl))}>
            <span>
              <i style={{ background: cl.crossed ? '#f38ba8' : '#f9e2af' }} />
              {cl.label}
              {cl.crossed ? ' · over' : ''}
            </span>
            <span className="binding">{cl.binding}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
