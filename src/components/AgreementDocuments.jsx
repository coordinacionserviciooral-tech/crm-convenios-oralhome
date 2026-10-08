import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { downloadFile, errorMessage } from "../lib/crm";
import {
  DOCUMENT_BUCKET,
  documentPath,
  validateDocument,
} from "../lib/documents";

export default function AgreementDocuments({ row, canEdit, isAdmin }) {
  const [documents, setDocuments] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [category, setCategory] = useState("Contrato"),
    [description, setDescription] = useState(""),
    [archived, setArchived] = useState(false);
  const input = useRef(null),
    lock = useRef(false),
    sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    const all = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase
        .from("agreement_documents")
        .select("*")
        .eq("agreement_id", row.Id)
        .order("created_at", { ascending: false })
        .range(offset, offset + 99);
      if (current !== sequence.current) return;
      if (error) {
        setNotice(errorMessage(error));
        setLoading(false);
        return;
      }
      all.push(...data);
      if (data.length < 100) break;
    }
    setDocuments(all);
    setLoading(false);
  }, [row.Id]);
  useEffect(() => {
    const tracker = sequence;
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) void load();
    });
    return () => {
      canceled = true;
      tracker.current++;
    };
  }, [load]);
  async function upload(event) {
    event.preventDefault();
    if (lock.current) return;
    const files = [...(input.current?.files || [])];
    try {
      if (!files.length) throw new Error("Selecciona uno o más archivos.");
      files.forEach(validateDocument);
    } catch (e) {
      setNotice(errorMessage(e));
      return;
    }
    lock.current = true;
    setBusy(true);
    setNotice("");
    let completed = 0;
    try {
      for (const file of files) {
        const id = crypto.randomUUID(),
          path = documentPath(row.Id, file.name, id);
        const { error: uploadError } = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .upload(path, file, {
            upsert: false,
            contentType: file.type || "application/octet-stream",
          });
        if (uploadError) throw uploadError;
        const { error } = await supabase.from("agreement_documents").insert({
          id,
          agreement_id: row.Id,
          original_name: file.name,
          storage_path: path,
          media_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          category,
          description: description.trim(),
        });
        if (error) {
          const { error: cleanup } = await supabase.storage
            .from(DOCUMENT_BUCKET)
            .remove([path]);
          if (cleanup)
            throw new Error(
              `${errorMessage(error)} El archivo quedó sin vincular; solicita revisión al administrador.`,
            );
          throw error;
        }
        completed++;
      }
      input.current.value = "";
      setDescription("");
      setNotice(`${completed} documento(s) cargado(s).`);
    } catch (error) {
      setNotice(
        `${completed ? `${completed} documento(s) guardado(s). ` : ""}${errorMessage(error)}`,
      );
    } finally {
      await load();
      lock.current = false;
      setBusy(false);
    }
  }
  async function download(document) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .download(document.storage_path);
      if (error) throw error;
      downloadFile(document.original_name, data, document.media_type);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function archive(document) {
    if (lock.current || !isAdmin) return;
    if (
      !confirm(
        `${document.archived_at ? "¿Restaurar" : "¿Archivar"} el documento ${document.original_name}?`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await supabase
        .from("agreement_documents")
        .update({
          archived_at: document.archived_at ? null : new Date().toISOString(),
        })
        .eq("id", document.id)
        .eq("updated_at", document.updated_at)
        .select("id");
      if (error) throw error;
      if (!data.length)
        throw new Error("El documento cambió. Actualiza la lista.");
      setNotice(
        document.archived_at
          ? "Documento restaurado."
          : "Documento archivado. El archivo se conserva.",
      );
      await load();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const visible = documents.filter((d) =>
    archived ? !!d.archived_at : !d.archived_at,
  );
  return (
    <section
      className="documents"
      aria-label={`Documentos del convenio ${row.Id}`}
    >
      <h4>Documentos del convenio</h4>
      <p className="muted">
        Contratos, anexos y soportes. Archivos privados de hasta 25 MB cada uno.
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="inline">
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => void load()}
        >
          Actualizar documentos
        </button>
        {isAdmin && (
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{" "}
            Ver documentos archivados
          </label>
        )}
      </div>
      {loading ? (
        <p role="status">Cargando documentos…</p>
      ) : (
        <ul className="document-list">
          {visible.map((d) => (
            <li key={d.id}>
              <div>
                <b>{d.original_name}</b>
                <p>
                  {d.category} · {(d.size_bytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                  {new Date(d.created_at).toLocaleDateString("es-CO", {
                    timeZone: "America/Bogota",
                  })}
                </p>
                {d.description && <p>{d.description}</p>}
              </div>
              <div className="inline">
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => download(d)}
                >
                  Descargar
                </button>
                {isAdmin && (
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => archive(d)}
                  >
                    {d.archived_at
                      ? "Restaurar documento"
                      : "Archivar documento"}
                  </button>
                )}
              </div>
            </li>
          ))}
          {!visible.length && (
            <li>Sin documentos {archived ? "archivados" : "adjuntos"}.</li>
          )}
        </ul>
      )}
      {canEdit && !row.archived_at && (
        <form onSubmit={upload} className="document-form">
          <label className="field">
            Archivos
            <input ref={input} type="file" multiple disabled={busy} />
          </label>
          <label className="field">
            Tipo de documento
            <select
              value={category}
              disabled={busy}
              onChange={(e) => setCategory(e.target.value)}
            >
              {["Contrato", "Anexo", "Otrosí", "Soporte", "Otro"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Descripción o información adicional
            <textarea
              value={description}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? "Procesando…" : "Cargar documentos"}
          </button>
        </form>
      )}
    </section>
  );
}
