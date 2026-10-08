import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  agreementsCsv,
  csvCell,
  downloadFile,
  emptyAgreement,
  errorMessage,
  MONTHS,
  normalizeAgreement,
  ROLES,
  todayBogota,
  visibleAgreements,
} from "../lib/crm";
import {
  organizations,
  followups,
  reportTables,
  excelReport,
  pdfReport,
} from "../lib/reports";
import Agreement from "./Agreement";
import AgreementEditor from "./AgreementEditor";
import AdminPanel from "./AdminPanel";
import MetricIcon from "./MetricIcon";
import ThemeToggle from "./ThemeToggle";
import { PasswordForm } from "./Auth";

export default function Dashboard({ profile, signOut }) {
  const [rows, setRows] = useState([]),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(null);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("activos"),
    [month, setMonth] = useState("");
  const [metric, setMetric] = useState("convenios"),
    [organization, setOrganization] = useState(""),
    [selectedAgreement, setSelectedAgreement] = useState(null),
    [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const searchInput = useRef(null);
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
    () =>
      visibleAgreements(rows, query, status, month).filter(
        (r) =>
          (!organization || r.Compañia.trim().toUpperCase() === organization) &&
          (!selectedAgreement || r.Id === selectedAgreement),
      ),
    [rows, query, status, month, organization, selectedAgreement],
  );
  const active = rows.filter((r) => !r.archived_at),
    pending = followups(active),
    today = todayBogota();
  const groups = organizations(filtered),
    isFollowups = ["pendientes", "vencidos"].includes(metric),
    activities = isFollowups
      ? followups(filtered, metric === "vencidos", today)
      : null,
    exportRows = isFollowups
      ? filtered.filter((r) => activities.some((a) => a.agreement.Id === r.Id))
      : filtered;
  const metricTitle = {
    convenios: "Convenios",
    organizaciones: "Organizaciones activas",
    pendientes: "Seguimientos pendientes",
    vencidos: "Seguimientos vencidos",
  }[metric];
  function home(next = "convenios") {
    setView("convenios");
    setMetric(next);
    setStatus("activos");
    setMonth("");
    setQuery("");
    setOrganization("");
    setSelectedAgreement(null);
    setOpen(null);
  }
  function showAgreement(row) {
    setMetric("convenios");
    setOrganization("");
    setSelectedAgreement(row.Id);
    setOpen(row.Id);
  }
  async function save(payload, original) {
    if (!canEdit)
      throw new Error("Tu rol permite consultar, pero no editar convenios.");
    if (!original.Id && !isAdmin)
      throw new Error("Solo el administrador puede crear convenios.");
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
    if (!isAdmin) return;
    const csv =
      metric === "organizaciones"
        ? [
            ["Organización", "Convenios activos"],
            ...groups.map((g) => [g.name, g.agreements.length]),
          ]
            .map((r) => r.map(csvCell).join(";"))
            .join("\r\n")
        : isFollowups
          ? (() => {
              const t = reportTables(exportRows, activities)[2];
              return [t.columns, ...t.data]
                .map((r) => r.map(csvCell).join(";"))
                .join("\r\n");
            })()
          : null;
    downloadFile(
      `CRM_Oralhome_${metric}_${status}_${today}.csv`,
      csv === null ? agreementsCsv(exportRows) : "\ufeff" + csv,
      "text/csv;charset=utf-8",
    );
  }
  async function exportReport(format) {
    if (!isAdmin || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try {
      const content =
        format === "xlsx"
          ? await excelReport(
              exportRows,
              activities,
              metric === "organizaciones",
            )
          : await pdfReport(
              exportRows,
              activities,
              metricTitle,
              metric === "organizaciones",
            );
      downloadFile(
        `CRM_Oralhome_${metric}_${today}.${format}`,
        content,
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      );
    } catch (error) {
      setNotice({ error: true, text: errorMessage(error) });
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }
  async function backup() {
    if (!isAdmin || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try {
      const documents = [];
      for (let offset = 0; isAdmin; offset += 500) {
        const { data, error } = await supabase
          .from("agreement_documents")
          .select("*")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        documents.push(...data);
        if (data.length < 500) break;
      }
      downloadFile(
        `CRM_Oralhome_respaldo_${today}.json`,
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            records: rows,
            documents,
            file_contents_included: false,
          },
          null,
          2,
        ),
        "application/json",
      );
    } catch (error) {
      setNotice({ error: true, text: errorMessage(error) });
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }
  const showAdmin =
    isAdmin && ["usuarios", "auditoria", "alertas"].includes(view);
  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <button
            className="logo-home"
            aria-label="Ir al inicio"
            onClick={() => home()}
          >
            <img alt="Oralhome" src="/LOGO-ORAL-HOME SIN FONDO.png" />
          </button>
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
              onClick={() => (key === "convenios" ? home() : setView(key))}
            >
              {label}
            </button>
          ))}
          <ThemeToggle />
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
          <section className="overview" aria-label="Resumen de gestión">
            <div>
              <p className="eyebrow">ORALHOME · RELACIONES CORPORATIVAS</p>
              <h2>Gestión de convenios</h2>
              <p className="muted">
                Organizaciones, tarifas y seguimientos en un solo lugar.
              </p>
            </div>
            <span className="overview-label">
              <span aria-hidden="true" />
              Vista general
            </span>
          </section>
          <div className="kpis">
            <button
              className="kpi"
              aria-pressed={metric === "convenios"}
              onClick={() => home()}
            >
              <MetricIcon type="convenios" />
              <b>{active.length}</b>
              <span>Convenios activos</span>
            </button>
            <button
              className="kpi"
              aria-pressed={metric === "organizaciones"}
              onClick={() => home("organizaciones")}
            >
              <MetricIcon type="organizaciones" />
              <b>
                {
                  new Set(
                    active.map((r) => (r.Compañia || "").trim().toUpperCase()),
                  ).size
                }
              </b>
              <span>Organizaciones activas</span>
            </button>
            <button
              className="kpi"
              aria-pressed={metric === "pendientes"}
              onClick={() => home("pendientes")}
            >
              <MetricIcon type="pendientes" />
              <b>{pending.length}</b>
              <span>Seguimientos pendientes</span>
            </button>
            <button
              className="kpi"
              aria-pressed={metric === "vencidos"}
              onClick={() => home("vencidos")}
            >
              <MetricIcon type="vencidos" />
              <b className="overdue">
                {pending.filter((a) => a.fecha && a.fecha < today).length}
              </b>
              <span>Seguimientos vencidos</span>
            </button>
          </div>
          <section className="toolbar" aria-label="Filtros">
            <div className="field search-field">
              <label htmlFor="agreement-search">Buscar convenio</label>
              <div className="search-controls">
                <input
                  id="agreement-search"
                  ref={searchInput}
                  type="search"
                  className="search"
                  placeholder="Compañía, producto, responsable, correo o actividad"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Limpiar búsqueda"
                  disabled={!query}
                  onClick={() => {
                    setQuery("");
                    searchInput.current?.focus();
                  }}
                >
                  Limpiar
                </button>
              </div>
            </div>
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
            {isAdmin && (
              <>
                <button
                  className="btn ghost"
                  disabled={loading || !exportRows.length || exporting}
                  onClick={exportCsv}
                >
                  Exportar CSV
                </button>
                <button
                  className="btn ghost"
                  disabled={loading || !exportRows.length || exporting}
                  onClick={() => void exportReport("pdf")}
                >
                  Exportar PDF
                </button>
                <button
                  className="btn ghost"
                  disabled={loading || !exportRows.length || exporting}
                  onClick={() => void exportReport("xlsx")}
                >
                  Exportar Excel
                </button>
                {exporting && (
                  <span role="status">Preparando exportación…</span>
                )}
              </>
            )}
            {isAdmin && (
              <button
                className="btn ghost"
                disabled={loading || exporting}
                onClick={() => void backup()}
                title="Incluye datos y referencias de documentos. Los archivos se descargan por separado."
              >
                Respaldo de datos JSON
              </button>
            )}
            {isAdmin && (
              <button
                className="btn primary"
                onClick={() => setEditing(emptyAgreement())}
              >
                + Nuevo convenio
              </button>
            )}
            <span className="muted">
              {isFollowups
                ? activities.length
                : metric === "organizaciones"
                  ? groups.length
                  : filtered.length}{" "}
              resultado(s) · {rows.filter((r) => !!r.archived_at).length}{" "}
              archivado(s)
            </span>
          </div>
          <div className="inline">
            <h2>
              {metricTitle}
              {organization ? ` · ${groups[0]?.name || organization}` : ""}
            </h2>
            {(organization || selectedAgreement || metric !== "convenios") && (
              <button className="btn ghost" onClick={() => home()}>
                Ver todos los convenios
              </button>
            )}
          </div>
          {loading ? (
            <p className="card" role="status">
              Cargando convenios…
            </p>
          ) : metric === "organizaciones" ? (
            <section className="grid" aria-label="Organizaciones activas">
              {groups.map((g) => (
                <article className="card" key={g.key}>
                  <h3>{g.name}</h3>
                  <p>{g.agreements.length} convenio(s)</p>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setMetric("convenios");
                      setOrganization(g.key);
                      setOpen(null);
                    }}
                  >
                    Ver convenios de {g.name}
                  </button>
                </article>
              ))}
              {!groups.length && (
                <p className="card">No hay organizaciones con estos filtros.</p>
              )}
            </section>
          ) : isFollowups ? (
            <section className="grid" aria-label={metricTitle}>
              {activities.map((a) => (
                <article
                  className="card"
                  key={`${a.agreement.Id}:${a.id || a.index}`}
                >
                  <h3>{a.agreement.Compañia}</h3>
                  <p>{a.agreement.Producto}</p>
                  <b className={a.fecha && a.fecha < today ? "overdue" : ""}>
                    {a.fecha || "Sin fecha"}
                  </b>
                  <p>{a.nota || "Sin nota"}</p>
                  <button
                    className="btn primary"
                    onClick={() => showAgreement(a.agreement)}
                  >
                    Ver convenio
                  </button>
                </article>
              ))}
              {!activities.length && (
                <p className="card">No hay seguimientos con estos filtros.</p>
              )}
            </section>
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
