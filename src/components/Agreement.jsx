import { money, pendingActivities, todayBogota } from "../lib/crm";
import AgreementDocuments from "./AgreementDocuments";
export default function Agreement({
  row,
  expanded,
  toggle,
  canEdit,
  isAdmin,
  edit,
  archive,
  busy,
}) {
  const activities = [...row.actividades].sort((a, b) =>
    (a.fecha || "9999").localeCompare(b.fecha || "9999"),
  );
  const next = pendingActivities(row)[0];
  return (
    <article className={"agreement" + (row.archived_at ? " archived" : "")}>
      <button
        className="agreement-top"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <div>
          <h3>{row.Compañia}</h3>
          <span className="badge">{row.Producto || "Sin producto"}</span>
          <p className="muted">
            Renovación: {row.Mes_renovacion || "Sin mes"} · Gestión:{" "}
            {row.Fecha_Gestion_comercial || "Sin fecha"}
          </p>
          {row.archived_at && <span className="badge warning">Archivado</span>}
        </div>
        <div className="next">
          <b>Próxima actividad</b>
          <p className={next && next.fecha < todayBogota() ? "overdue" : ""}>
            {next
              ? `${next.fecha}${next.fecha < todayBogota() ? " · Vencida" : ""}`
              : "Al día"}
          </p>
          <span>{expanded ? "Ocultar detalles ↑" : "Ver detalles ↓"}</span>
        </div>
      </button>
      {expanded && (
        <div className="details">
          <p>
            <b>Actividad comercial:</b>{" "}
            {row.Actividad_comercial || "Sin información"}
          </p>
          <p>
            <b>Responsable:</b> {row.Responsable_cliente || "Sin asignar"}
          </p>
          <p>
            <b>Teléfono:</b> {row.Telefono || "Sin teléfono"} · <b>Correo:</b>{" "}
            {row.email_cliente || "Sin correo"}
          </p>
          <h4>Tarifas</h4>
          <div className="rates">
            {Object.entries(row.tarifa)
              .sort()
              .map(([year, value]) => (
                <div className="rate" key={year}>
                  <small>{year}</small>
                  <br />
                  <b>{money.format(value || 0)}</b>
                </div>
              ))}
          </div>
          {Object.keys(row.tarifa).length === 0 && (
            <p className="muted">Sin tarifas registradas.</p>
          )}
          <h4>Seguimientos</h4>
          {activities.length ? (
            activities.map((a, i) => (
              <div className="activity" key={a.id || i}>
                <span
                  className={
                    "badge " +
                    (a.cumplida
                      ? "success"
                      : a.fecha && a.fecha < todayBogota()
                        ? "warning"
                        : "")
                  }
                >
                  {a.cumplida ? "Completada" : "Pendiente"}
                </span>
                <div>
                  <b>{a.fecha || "Sin fecha"}</b>
                  <p>{a.nota || "Sin nota"}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Sin seguimientos.</p>
          )}
          <div className="inline">
            {canEdit && !row.archived_at && (
              <button className="btn primary" disabled={busy} onClick={edit}>
                Editar
              </button>
            )}
            {isAdmin && (
              <button
                className={"btn " + (row.archived_at ? "ghost" : "danger")}
                disabled={busy}
                onClick={archive}
              >
                {row.archived_at ? "Restaurar convenio" : "Archivar convenio"}
              </button>
            )}
          </div>
          {isAdmin && (
            <AgreementDocuments row={row} canEdit={canEdit} isAdmin={isAdmin} />
          )}
        </div>
      )}
    </article>
  );
}
