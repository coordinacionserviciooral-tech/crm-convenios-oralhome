export const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
export const ROLES = {
  administrador: "Administrador",
  comercial: "Comercial",
  consulta: "Consulta",
};
export const FIELDS = [
  "Compañia",
  "Actividad_comercial",
  "Producto",
  "Fecha_Gestion_comercial",
  "Responsable_cliente",
  "Telefono",
  "email_cliente",
  "Mes_renovacion",
];
export const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
export function todayBogota(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function emptyAgreement() {
  const end = Math.max(2026, Number(todayBogota().slice(0, 4)) + 1);
  return {
    Compañia: "",
    Actividad_comercial: "",
    Producto: "",
    Fecha_Gestion_comercial: null,
    Responsable_cliente: "",
    Telefono: "",
    email_cliente: "",
    Mes_renovacion: "Enero",
    tarifa: Object.fromEntries(
      Array.from({ length: end - 2016 }, (_, i) => [2017 + i, 0]),
    ),
    actividades: [],
  };
}
export function normalizeAgreement(row) {
  return {
    ...row,
    tarifa:
      row.tarifa && typeof row.tarifa === "object" && !Array.isArray(row.tarifa)
        ? row.tarifa
        : {},
    actividades: Array.isArray(row.actividades) ? row.actividades : [],
  };
}
export function agreementPayload(data) {
  const payload = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      field === "Fecha_Gestion_comercial"
        ? data[field] || null
        : String(data[field] ?? "").trim(),
    ]),
  );
  if (!payload.Compañia) throw new Error("Escribe la compañía.");
  if (payload.Mes_renovacion && !MONTHS.includes(payload.Mes_renovacion))
    throw new Error("Selecciona un mes de renovación válido.");
  if (
    payload.Fecha_Gestion_comercial &&
    !validDate(payload.Fecha_Gestion_comercial)
  )
    throw new Error("La fecha de gestión no es válida.");
  if (
    payload.email_cliente &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email_cliente)
  )
    throw new Error("Revisa el correo del cliente.");
  payload.tarifa = Object.fromEntries(
    Object.entries(data.tarifa || {}).map(([year, value]) => {
      const number = Number(value);
      if (!/^\d{4}$/.test(year) || !Number.isFinite(number) || number < 0)
        throw new Error("Las tarifas deben tener año y valor no negativo.");
      return [year, number];
    }),
  );
  payload.actividades = (data.actividades || [])
    .map((a) => ({
      ...a,
      fecha: a.fecha || "",
      nota: String(a.nota ?? "").trim(),
      cumplida: Boolean(a.cumplida),
    }))
    .filter((a) => a.fecha || a.nota);
  if (payload.actividades.some((a) => a.fecha && !validDate(a.fecha)))
    throw new Error("Revisa las fechas de seguimiento.");
  return payload;
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function pendingActivities(row) {
  return (row.actividades || [])
    .filter((a) => !a.cumplida && validDate(a.fecha || ""))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}
export function searchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
export function visibleAgreements(
  rows,
  query = "",
  status = "activos",
  month = "",
) {
  const needle = searchText(query);
  return rows.filter(
    (row) =>
      (status === "todos" ||
        (status === "archivados" ? !!row.archived_at : !row.archived_at)) &&
      (!month || row.Mes_renovacion === month) &&
      searchText(FIELDS.map((k) => row[k]).join(" ")).includes(needle),
  );
}
export function csvCell(value) {
  let text =
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value ?? "");
  // Prevent spreadsheet applications from treating contact data as formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function agreementsCsv(rows) {
  const years = [
    ...new Set(rows.flatMap((row) => Object.keys(row.tarifa || {}))),
  ].sort();
  const cols = [
    "Id",
    ...FIELDS,
    ...years.map((y) => `Tarifa ${y}`),
    "tarifa",
    "actividades",
    "archived_at",
    "created_at",
    "updated_at",
  ];
  return (
    "\ufeff" +
    [
      cols.map(csvCell).join(";"),
      ...rows.map((row) =>
        cols
          .map((key) =>
            csvCell(
              key.startsWith("Tarifa ") ? row.tarifa?.[key.slice(7)] : row[key],
            ),
          )
          .join(";"),
      ),
    ].join("\r\n")
  );
}
export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(error) {
  if (error?.code === "42501")
    return "No tienes permiso para esta operación. Revisa tu acceso con el administrador.";
  if (error?.message?.includes("Failed to fetch"))
    return "No hay conexión con el servidor. Tus cambios no se han guardado; vuelve a intentarlo.";
  return error?.message || "No fue posible completar la operación.";
}
