import { useRef, useState } from "react";
import Modal from "./Modal";
import {
  agreementPayload,
  emptyAgreement,
  errorMessage,
  MONTHS,
} from "../lib/crm";
const LABELS = [
  ["Compañia", "Compañía"],
  ["Producto", "Producto"],
  ["Responsable_cliente", "Responsable"],
  ["Telefono", "Teléfono"],
  ["email_cliente", "Correo del cliente"],
];
export default function AgreementEditor({ initial, onClose, onSave }) {
  const [data, setData] = useState(() => ({
    ...emptyAgreement(),
    ...initial,
    tarifa: {
      ...(initial.Id ? {} : emptyAgreement().tarifa),
      ...initial.tarifa,
    },
    actividades: (initial.actividades || []).map((a) => ({ ...a })),
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [year, setYear] = useState("");
  const lock = useRef(false),
    dirty = useRef(false);
  function set(field, value) {
    dirty.current = true;
    setData((d) => ({ ...d, [field]: value }));
  }
  function close() {
    if (
      !dirty.current ||
      window.confirm("Hay cambios sin guardar. ¿Cerrar el formulario?")
    )
      onClose();
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = agreementPayload(data);
      await onSave(payload, initial);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function activity(index, field, value) {
    set(
      "actividades",
      data.actividades.map((a, i) =>
        i === index ? { ...a, [field]: value } : a,
      ),
    );
  }
  function addYear() {
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2200) {
      setError("Ingresa un año válido entre 1900 y 2200.");
      return;
    }
    if (Object.hasOwn(data.tarifa, year)) {
      setError("Ese año ya está en la tabla.");
      return;
    }
    set("tarifa", { ...data.tarifa, [year]: 0 });
    setYear("");
    setError("");
  }
  return (
    <Modal
      title={initial.Id ? "Editar convenio" : "Nuevo convenio"}
      busy={busy}
      onClose={close}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="formgrid">
            {LABELS.map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  required={key === "Compañia"}
                  maxLength={1000}
                  type={key === "email_cliente" ? "email" : "text"}
                  value={data[key] || ""}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            <label className="field">
              Mes de renovación
              <select
                value={data.Mes_renovacion || ""}
                onChange={(e) => set("Mes_renovacion", e.target.value)}
              >
                <option value="">Sin mes definido</option>
                {MONTHS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Fecha de gestión comercial
              <input
                type="date"
                value={data.Fecha_Gestion_comercial || ""}
                onChange={(e) =>
                  set("Fecha_Gestion_comercial", e.target.value || null)
                }
              />
            </label>
          </div>
          <label className="field">
            Actividad comercial
            <textarea
              rows={3}
              value={data.Actividad_comercial || ""}
              onChange={(e) => set("Actividad_comercial", e.target.value)}
            />
          </label>
          <h3>Tarifas por año · COP</h3>
          <div className="rates">
            {Object.keys(data.tarifa)
              .sort()
              .map((y) => (
                <label className="field" key={y}>
                  {y}
                  <input
                    type="number"
                    aria-label={`Tarifa ${y}`}
                    min="0"
                    step="0.01"
                    required
                    value={data.tarifa[y] ?? 0}
                    onChange={(e) =>
                      set("tarifa", { ...data.tarifa, [y]: e.target.value })
                    }
                  />
                </label>
              ))}
          </div>
          <div className="inline">
            <label className="field">
              Añadir año
              <input
                type="number"
                min="1900"
                max="2200"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
            <button type="button" className="btn ghost" onClick={addYear}>
              Agregar año
            </button>
          </div>
          <h3>Seguimientos</h3>
          {data.actividades.map((a, i) => (
            <section className="followup" key={a.id || i}>
              <h4>Seguimiento {i + 1}</h4>
              <div className="formgrid">
                <label className="field">
                  Fecha de seguimiento {i + 1}
                  <input
                    type="date"
                    value={a.fecha || ""}
                    onChange={(e) => activity(i, "fecha", e.target.value)}
                  />
                </label>
                <label className="field">
                  Nota de seguimiento {i + 1}
                  <textarea
                    rows={2}
                    value={a.nota || ""}
                    onChange={(e) => activity(i, "nota", e.target.value)}
                  />
                </label>
                <label className="field">
                  Estado de seguimiento {i + 1}
                  <select
                    value={String(!!a.cumplida)}
                    onChange={(e) =>
                      activity(i, "cumplida", e.target.value === "true")
                    }
                  >
                    <option value="false">Pendiente</option>
                    <option value="true">Completada</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (
                    (!a.fecha && !a.nota) ||
                    confirm("¿Eliminar este seguimiento del formulario?")
                  )
                    set(
                      "actividades",
                      data.actividades.filter((_, index) => index !== i),
                    );
                }}
              >
                Eliminar seguimiento {i + 1}
              </button>
            </section>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              set("actividades", [
                ...data.actividades,
                {
                  id: crypto.randomUUID(),
                  fecha: "",
                  nota: "",
                  cumplida: false,
                },
              ])
            }
          >
            Añadir seguimiento
          </button>
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button disabled={busy} className="btn primary">
            {busy ? "Guardando…" : "Guardar convenio"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
