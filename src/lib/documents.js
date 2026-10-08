export const DOCUMENT_BUCKET = "crm-convenios-documentos";
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
export function documentPath(agreementId, fileName, id = crypto.randomUUID()) {
  if (!Number.isSafeInteger(Number(agreementId)) || Number(agreementId) < 1)
    throw new Error("Guarda el convenio antes de adjuntar documentos.");
  const name =
    fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-180) || "documento";
  return `${agreementId}/${id}/${name}`;
}
export function validateDocument(file) {
  if (!file || !file.size)
    throw new Error("Selecciona un archivo con contenido.");
  if (file.size > MAX_DOCUMENT_SIZE)
    throw new Error("Cada archivo puede tener hasta 25 MB.");
  if (file.name.length > 255)
    throw new Error("El nombre del archivo es demasiado largo.");
}
