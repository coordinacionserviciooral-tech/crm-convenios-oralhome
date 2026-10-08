import { useEffect, useRef } from "react";
export default function Modal({ title, onClose, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id="editor-title">{title}</h2>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
      {children}
    </dialog>
  );
}
