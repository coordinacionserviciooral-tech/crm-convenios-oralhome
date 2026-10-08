import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  agreementsCsv,
  downloadFile,
  emptyAgreement,
  errorMessage,
  MONTHS,
  normalizeAgreement,
  pendingActivities,
  ROLES,
  todayBogota,
  visibleAgreements,
} from "../lib/crm";
import Agreement from "./Agreement";
import AgreementEditor from "./AgreementEditor";
import AdminPanel from "./AdminPanel";
import { PasswordForm } from "./Auth";

export default function Dashboard({ profile, signOut }) {
  const [rows, setRows] = useState([]),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(null);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("activos"),
    [month, setMonth] = useState("");
  const [open, setOpen] = useState(null),
    [editing, setEditing] = useState(null),
    [view, setView] = useState("convenios"),
    [busyId, setBusyId] = useState(null);
  const live = useRef(true),
    requestId = useRef(0),
    mutationLock = useRef(false);
  const isAdmin = profile.role === "administrador",
    canEdit = isAdmin || profile.role === "comercial";
  const loadRows = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const all = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("Aliados")
          .select("*")
          .order("Id", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        all.push(...data.map(normalizeAgreement));
        if (data.length < pageSize) break;
      }
      if (live.current && id === requestId.current) {
        setRows(all);
        setLoading(false);
      }
      return true;
    } catch (error) {
      if (live.current && id === requestId.current) {
        setLoading(false);
        setNotice({ error: true, text: errorMessage(error) });
      }
      return false;
    }
  }, []);
  useEffect(() => {
    live.current = true;
    queueMicrotask(() => {
      if (live.current) void loadRows();
    });
    return () => {
      live.current = false;
    };
  }, [loadRows]);
  const filtered = useMemo(
    () => visibleAgreements(rows, query, status, month),
    [rows, query, status, month],
  );
  const active = rows.filter((r) => !r.archived_at),
    pending = active.flatMap(pendingActivities),
    today = todayBogota();
  async function save(payload, original) {
    if (!canEdit)
      throw new Error("Tu rol permite consultar, pero no editar convenios.");
    let request = original.Id
      ? supabase
          .from("Aliados")
          .update(payload)
          .eq("Id", original.Id)
          .is("archived_at", null)
      : supabase.from("Aliados").insert(payload);
    if (original.Id && original.updated_at)
      request = request.eq("updated_at", original.updated_at);
    const { data, error } = await request.select("*");
    if (error) throw error;
    if (!data?.length)
      throw new Error(
        "El convenio cambió desde que lo abriste o ya no tienes permiso. Cierra el formulario, actualiza la lista y vuelve a abrirlo.",
      );
    const saved = normalizeAgreement(data[0]);
    setRows((previous) =>
      original.Id
        ? previous.map((r) => (r.Id === saved.Id ? saved : r))
        : [saved, ...previous],
    );
    setNotice({ text: "Convenio guardado correctamente." });
  }
  async function archive(row) {
    if (!isAdmin || mutationLock.current) return;
    if (
      !confirm(
        `${row.archived_at ? "¿Restaurar" : "¿Archivar"} el convenio de ${row.Compañia}?`,
      )
    )
      return;
    mutationLock.current = true;
    setBusyId(row.Id);
    try {
      let request = supabase
        .from("Aliados")
        .update({
          archived_at: row.archived_at ? null : new Date().toISOString(),
        })
        .eq("Id", row.Id);
      if (row.updated_at) request = request.eq("updated_at", row.updated_at);
      const { data, error } = await request.select("*");
      if (error) throw error;
      if (!data?.length)
        throw new Error(
          "El registro cambió o no tienes permiso. Actualiza la lista antes de intentarlo de nuevo.",
        );
      setRows((previous) =>
        previous.map((r) =>
          r.Id === row.Id ? normalizeAgreement(data[0]) : r,
        ),
      );
      setNotice({
        text: row.archived_at
          ? "Convenio restaurado."
          : "Convenio archivado. Puedes restaurarlo desde el filtro Archivados.",
      });
    } catch (error) {
      setNotice({ error: true, text: errorMessage(error) });
    } finally {
      mutationLock.current = false;
      setBusyId(null);
    }
  }
  function exportCsv() {
    downloadFile(
      `CRM_Oralhome_${status}_${today}.csv`,
      agreementsCsv(filtered),
      "text/csv;charset=utf-8",
    );
  }
  function backup() {
    downloadFile(
      `CRM_Oralhome_respaldo_${today}.json`,
      JSON.stringify(
        { exported_at: new Date().toISOString(), records: rows },
        null,
        2,
      ),
      "application/json",
    );
  }
  const showAdmin =
    isAdmin && ["usuarios", "auditoria", "alertas"].includes(view);
  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img alt="Oralhome" src="/LOGO-ORAL-HOME SIN FONDO.png" />
          <div>
            <h1>CRM de convenios</h1>
            <small>
              {profile.full_name || profile.email} · {ROLES[profile.role]}
            </small>
          </div>
        </div>
        <nav className="nav" aria-label="Secciones del CRM">
          {[
            ["convenios", "Convenios"],
            ...(isAdmin
              ? [
                  ["usuarios", "Usuarios"],
                  ["auditoria", "Auditoría"],
                  ["alertas", "Alertas"],
                ]
              : []),
            ["cuenta", "Mi cuenta"],
          ].map(([key, label]) => (
            <button
              className={"btn " + (key === view ? "primary" : "ghost")}
              aria-current={view === key ? "page" : undefined}
              key={key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
          <button className="btn dark" onClick={signOut}>
            Cerrar sesión
          </button>
        </nav>
      </header>
      {notice && (
        <div
          className={"notice notice-row" + (notice.error ? " error" : "")}
          role={notice.error ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button
            className="btn ghost"
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {showAdmin ? (
        <AdminPanel key={view} view={view} profile={profile} />
      ) : view === "cuenta" ? (
        <section className="account">
          <PasswordForm onComplete={() => setView("convenios")} />
        </section>
      ) : (
        <main>
          <div className="kpis">
            <div className="kpi">
              <b>{active.length}</b>
              <span>Convenios activos</span>
            </div>
            <div className="kpi">
              <b>
                {
                  new Set(
                    active.map((r) => (r.Compañia || "").trim().toUpperCase()),
                  ).size
                }
              </b>
              <span>Organizaciones activas</span>
            </div>
            <div className="kpi">
              <b>{pending.length}</b>
              <span>Seguimientos pendientes</span>
            </div>
            <div className="kpi">
              <b className="overdue">
                {pending.filter((a) => a.fecha < today).length}
              </b>
              <span>Seguimientos vencidos</span>
            </div>
          </div>
          <section className="toolbar" aria-label="Filtros">
            <label className="field search-field">
              Buscar convenio
              <input
                type="search"
                className="search"
                placeholder="Compañía, producto, responsable, correo o actividad"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="field">
              Estado
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="activos">Activos</option>
                <option value="archivados">Archivados</option>
                <option value="todos">Todos</option>
              </select>
            </label>
            <label className="field">
              Renovación
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Todos los meses</option>
                {MONTHS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </section>
          <div className="toolbar actions">
            <button
              className="btn ghost"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void loadRows();
              }}
            >
              Actualizar
            </button>
            <button
              className="btn ghost"
              disabled={loading || !filtered.length}
              onClick={exportCsv}
            >
              Exportar CSV
            </button>
            {isAdmin && (
              <button className="btn ghost" disabled={loading} onClick={backup}>
                Respaldo completo JSON
              </button>
            )}
            {canEdit && (
              <button
                className="btn primary"
                onClick={() => setEditing(emptyAgreement())}
              >
                + Nuevo convenio
              </button>
            )}
            <span className="muted">
              {filtered.length} resultado(s) ·{" "}
              {rows.filter((r) => !!r.archived_at).length} archivado(s)
            </span>
          </div>
          {loading ? (
            <p className="card" role="status">
              Cargando convenios…
            </p>
          ) : (
            <div className="grid">
              {filtered.map((row) => (
                <Agreement
                  key={row.Id}
                  row={row}
                  expanded={open === row.Id}
                  toggle={() => setOpen(open === row.Id ? null : row.Id)}
                  canEdit={canEdit}
                  isAdmin={isAdmin}
                  edit={() => setEditing(row)}
                  archive={() => archive(row)}
                  busy={busyId === row.Id}
                />
              ))}
              {!filtered.length && (
                <p className="card">
                  No hay convenios que coincidan con estos filtros.
                </p>
              )}
            </div>
          )}
        </main>
      )}
      {editing && (
        <AgreementEditor
          key={editing.Id || "new"}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
