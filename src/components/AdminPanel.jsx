import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage, ROLES } from "../lib/crm";
const PAGE_SIZE = 50;
const TABLES = {
  usuarios: "profiles",
  auditoria: "audit_logs",
  alertas: "alert_log",
};
const TITLES = {
  usuarios: "Usuarios autorizados",
  auditoria: "Historial de auditoría",
  alertas: "Historial de alertas",
};
export default function AdminPanel({ view, profile }) {
  const [rows, setRows] = useState([]),
    [page, setPage] = useState(0),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(null);
  const lock = useRef(false),
    live = useRef(true),
    sequence = useRef(0);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    const {
      data,
      error,
      count: total,
    } = await supabase
      .from(TABLES[view])
      .select("*", { count: "exact" })
      .order(view === "usuarios" ? "full_name" : "id", {
        ascending: view === "usuarios",
      })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!live.current || seq !== sequence.current) return;
    setLoading(false);
    if (error) setNotice(errorMessage(error));
    else {
      setRows(data || []);
      setCount(total || 0);
    }
  }, [view, page]);
  useEffect(() => {
    live.current = true;
    queueMicrotask(() => {
      if (live.current) void load();
    });
    return () => {
      live.current = false;
    };
  }, [load]);
  async function change(user, patch) {
    if (lock.current) return;
    if (
      user.id === profile.id &&
      (patch.is_active === false ||
        (patch.role && patch.role !== "administrador"))
    ) {
      setNotice(
        "No puedes bloquearte ni reducir tu propio rol desde esta pantalla. Solicita el cambio a otro administrador.",
      );
      return;
    }
    if (
      patch.is_active === false &&
      !confirm(`¿Bloquear el acceso de ${user.full_name || user.email}?`)
    )
      return;
    lock.current = true;
    setBusy(user.id);
    setNotice("");
    try {
      let request = supabase.from("profiles").update(patch).eq("id", user.id);
      if (user.updated_at) request = request.eq("updated_at", user.updated_at);
      const { data, error } = await request.select("*");
      if (error) throw error;
      if (!data?.length)
        throw new Error(
          "El perfil cambió o no tienes permiso. Actualiza la lista.",
        );
      setNotice("Usuario actualizado.");
      await load();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  return (
    <main className="card admin">
      <div className="inline">
        <h2>{TITLES[view]}</h2>
        <button
          className="btn ghost"
          disabled={loading || !!busy}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Actualizar historial
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {view === "usuarios" && (
        <p className="muted">
          Crea las cuentas en Supabase Authentication. Aquí puedes activar el
          acceso y asignar permisos. Consulta lee y exporta; Comercial crea y
          edita; Administrador gestiona usuarios y archivados.
        </p>
      )}
      {view === "alertas" && (
        <p className="muted">
          Renovación: avisos a 2 y 1 meses, al inicio del mes, y 8, 3 y 1 días
          calendario antes. Gestión: 8, 3 y 1 días calendario antes.
          Seguimientos pendientes: 8 días de lunes a viernes antes, sin
          calendario de festivos. Horarios: 08:00 y 15:00 de Colombia. Cada
          horario tiene su propio envío. Los fallos quedan registrados para
          reintento.
        </p>
      )}
      {loading ? (
        <p role="status">Cargando…</p>
      ) : (
        <div className="table-scroll">
          <table className="users">
            <thead>
              <tr>
                {(view === "usuarios"
                  ? ["Nombre", "Correo", "Rol", "Acceso"]
                  : view === "auditoria"
                    ? [
                        "Fecha",
                        "Usuario",
                        "Acción",
                        "Entidad",
                        "Registro",
                        "Detalle",
                      ]
                    : [
                        "Registro",
                        "Tipo",
                        "Fecha objetivo",
                        "Anticipación",
                        "Horario",
                        "Estado",
                        "Intentos",
                        "Envío / error",
                      ]
                ).map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {view === "usuarios" ? (
                    <>
                      <td>{row.full_name || "Sin nombre"}</td>
                      <td>{row.email}</td>
                      <td>
                        <select
                          aria-label={`Rol de ${row.email}`}
                          value={row.role}
                          disabled={!!busy || row.id === profile.id}
                          onChange={(e) =>
                            change(row, { role: e.target.value })
                          }
                        >
                          {Object.entries(ROLES).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className={
                            "btn " + (row.is_active ? "danger" : "primary")
                          }
                          disabled={!!busy || row.id === profile.id}
                          onClick={() =>
                            change(row, { is_active: !row.is_active })
                          }
                        >
                          {row.is_active ? "Bloquear" : "Activar"}
                        </button>
                        {row.id === profile.id && <small> Tu cuenta</small>}
                      </td>
                    </>
                  ) : view === "auditoria" ? (
                    <>
                      <td>
                        {new Date(row.created_at).toLocaleString("es-CO", {
                          timeZone: "America/Bogota",
                        })}
                      </td>
                      <td>{row.user_id || "Sistema"}</td>
                      <td>{row.action}</td>
                      <td>{row.entity}</td>
                      <td>{row.entity_id}</td>
                      <td>
                        <details>
                          <summary>Ver cambio</summary>
                          <pre>
                            {JSON.stringify(
                              { antes: row.old_data, después: row.new_data },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{row.agreement_id}</td>
                      <td>{row.alert_type}</td>
                      <td>{row.scheduled_for}</td>
                      <td>
                        {row.payload?.notice_label || `${row.days_before} días`}
                      </td>
                      <td>{row.run_slot === "pm" ? "15:00" : "08:00"}</td>
                      <td>{row.status || "Enviado (registro anterior)"}</td>
                      <td>{row.attempts ?? "—"}</td>
                      <td>
                        {row.sent_at
                          ? new Date(row.sent_at).toLocaleString("es-CO", {
                              timeZone: "America/Bogota",
                            })
                          : "Sin envío confirmado"}
                        {row.last_error && (
                          <p className="overdue">{row.last_error}</p>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p>No hay registros en esta sección.</p>}
        </div>
      )}
      <div className="pagination">
        <button
          className="btn ghost"
          disabled={page === 0 || loading}
          onClick={() => {
            setLoading(true);
            setPage((p) => p - 1);
          }}
        >
          Anterior
        </button>
        <span>
          Página {page + 1} · {count} registro(s)
        </span>
        <button
          className="btn ghost"
          disabled={(page + 1) * PAGE_SIZE >= count || loading}
          onClick={() => {
            setLoading(true);
            setPage((p) => p + 1);
          }}
        >
          Siguiente
        </button>
      </div>
    </main>
  );
}
