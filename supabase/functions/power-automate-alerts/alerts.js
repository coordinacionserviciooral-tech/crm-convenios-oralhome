const MONTHS = [
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
const DAY = 86400000;
export function bogotaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function subtractDays(value, days) {
  return new Date(new Date(`${value}T12:00:00Z`).getTime() - days * DAY)
    .toISOString()
    .slice(0, 10);
}
export function subtractWeekdays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  let count = 0;
  while (count < days) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (![0, 6].includes(date.getUTCDay())) count++;
  }
  return date.toISOString().slice(0, 10);
}
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}
async function digest(value) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function buildAlerts(rows, today, slot, recipient, from) {
  if (!isDate(today) || !["am", "pm"].includes(slot))
    throw new Error("Fecha u horario inválidos");
  const alerts = [],
    known = new Set();
  for (const row of rows) {
    if (row.archived_at) continue;
    const dates = [];
    if (isDate(row.Fecha_Gestion_comercial))
      dates.push({
        type: "gestion",
        date: row.Fecha_Gestion_comercial,
        days: [8, 3, 1],
      });
    const month = MONTHS.indexOf(row.Mes_renovacion);
    if (month >= 0) {
      let year = Number(today.slice(0, 4));
      let date = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const nextStart = new Date(Date.UTC(year + 1, month - 2, 1, 12))
        .toISOString()
        .slice(0, 10);
      if (today >= nextStart) year++;
      let start = new Date(Date.UTC(year, month - 2, 1, 12))
        .toISOString()
        .slice(0, 10);
      if (today < start) {
        year--;
        start = new Date(Date.UTC(year, month - 2, 1, 12))
          .toISOString()
          .slice(0, 10);
      }
      date = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const reviewed = row.tariff_reviewed_at
        ? bogotaDate(new Date(row.tariff_reviewed_at))
        : null;
      if (!reviewed || reviewed < start) {
        dates.push({ type: "renovacion", date, days: [8, 3, 1] });
        // Preserve the original monthly notices, with one event at the start of each notice month.
        for (const months of [2, 1]) {
          const due = new Date(Date.UTC(year, month - months, 1, 12))
            .toISOString()
            .slice(0, 10);
          if (due === today)
            dates.push({
              type: "renovacion_mensual",
              date,
              days: [
                Math.round(
                  (new Date(`${date}T12:00:00Z`).getTime() -
                    new Date(`${due}T12:00:00Z`).getTime()) /
                    DAY,
                ),
              ],
              explicitDue: due,
              label: `${months} mes(es)`,
            });
        }
        if (
          ![8, 3, 1].some((days) => subtractDays(date, days) === today) &&
          ![2, 1].some(
            (months) =>
              new Date(Date.UTC(year, month - months, 1, 12))
                .toISOString()
                .slice(0, 10) === today,
          )
        ) {
          dates.push({
            type: "renovacion_diaria",
            date,
            days: [0],
            explicitDue: today,
            label: "Renovación pendiente: actualizar tarifa",
          });
        }
      }
    }
    for (const activity of Array.isArray(row.actividades)
      ? row.actividades
      : []) {
      if (activity.cumplida || !isDate(activity.fecha)) continue;
      if (today < subtractWeekdays(activity.fecha, 8)) continue;
      dates.push({
        type: "actividad",
        date: activity.fecha,
        days: [8],
        business: true,
        explicitDue: today,
        note: activity.nota,
        identity:
          activity.id ||
          (await digest(JSON.stringify([activity.fecha, activity.nota || ""]))),
      });
    }
    for (const event of dates)
      for (const days of event.days) {
        const due =
          event.explicitDue ||
          (event.business
            ? subtractWeekdays(event.date, days)
            : subtractDays(event.date, days));
        if (due !== today) continue;
        const key = `${row.Id}:${event.type}:${event.identity ? `${event.identity}:` : ""}${event.date}:${days}:${slot}${["renovacion_diaria", "actividad"].includes(event.type) ? `:${today}` : ""}`;
        if (known.has(key)) continue;
        known.add(key);
        const label = {
          gestion: "Gestión comercial",
          renovacion: "Renovación",
          renovacion_mensual: "Renovación",
          renovacion_diaria: "Renovación pendiente",
          actividad: "Seguimiento pendiente",
        }[event.type];
        const subject = `CRM Oralhome · ${row.Compañia} · ${label}`;
        const html = `<h2>${escapeHtml(subject)}</h2><p><b>Producto:</b> ${escapeHtml(row.Producto || "Sin producto")}</p><p><b>Fecha objetivo:</b> ${event.date}</p><p><b>Anticipación:</b> ${event.label || `${days} días ${event.business ? "de lunes a viernes" : "calendario"}`}</p><p><b>Responsable:</b> ${escapeHtml(row.Responsable_cliente || "Sin asignar")}</p><p><b>Contacto:</b> ${escapeHtml(row.Telefono)} · ${escapeHtml(row.email_cliente)}</p>${event.note ? `<p><b>Seguimiento:</b> ${escapeHtml(event.note)}</p>` : ""}`;
        alerts.push({
          key,
          agreement_id: row.Id,
          type: event.type,
          date: event.date,
          days,
          slot,
          recipient,
          payload: {
            from,
            to: [recipient],
            subject,
            html,
            queued_at: new Date().toISOString(),
            due_date: due,
            notice_label:
              event.label ||
              `${days} días ${event.business ? "de lunes a viernes" : "calendario"}`,
            template_params: {
              to_email: recipient,
              compañia: escapeHtml(row.Compañia),
              producto: escapeHtml(row.Producto || "Sin producto"),
              mes_vence: event.date,
              tiempo_alerta:
                event.label ||
                `${days} días ${event.business ? "de lunes a viernes" : "calendario"}`,
              responsable: escapeHtml(row.Responsable_cliente || "Sin asignar"),
              contacto: escapeHtml(row.Telefono || "Sin teléfono"),
              detalles_alerta: escapeHtml(
                `${label}. Fecha programada: ${event.date}. ${event.note || ""}`,
              ),
            },
          },
        });
      }
  }
  return alerts;
}
export function buildDigest(alerts, today, slot, recipient, from) {
  if (!alerts.length) return null;
  const subject = `CRM Oralhome · Alertas ${today} · ${slot === "am" ? "08:00" : "15:00"}`;
  const details = alerts
    .map(
      (alert) =>
        alert.payload.template_params.detalles_alerta +
        ` · ${alert.payload.template_params.compañia} · ${alert.payload.template_params.producto}`,
    )
    .join("\n\n");
  return {
    key: `resumen:${today}:${slot}`,
    agreement_id: null,
    type: "resumen",
    date: today,
    days: 0,
    slot,
    recipient,
    payload: {
      from,
      to: [recipient],
      subject,
      html: `<h1>${escapeHtml(subject)}</h1>${alerts.map((alert) => alert.payload.html).join("<hr>")}`,
      queued_at: new Date().toISOString(),
      due_date: today,
      items: alerts,
      template_params: {
        to_email: recipient,
        compañia: "Resumen de convenios",
        producto: `${alerts.length} alerta(s) pendiente(s)`,
        mes_vence: today,
        tiempo_alerta: slot === "am" ? "08:00 Colombia" : "15:00 Colombia",
        responsable: "Coordinación de servicio",
        contacto: recipient,
        detalles_alerta: details,
      },
    },
  };
}
