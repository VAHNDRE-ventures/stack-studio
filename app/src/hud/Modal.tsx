import { useStudio } from '../store';

export function Modal() {
  const modal = useStudio((s) => s.modal);
  const setModal = useStudio((s) => s.setModal);
  if (!modal) return null;

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{modal.title}</h2>
          <button onClick={() => setModal(null)}>×</button>
        </div>
        <p className="modal-note">{modal.note}</p>
        {modal.rows.map(([k, v]) => (
          <div className="modal-row" key={k}>
            <span>{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
        {modal.source && <p className="modal-src">Verified · {modal.source}</p>}
      </div>
    </div>
  );
}
