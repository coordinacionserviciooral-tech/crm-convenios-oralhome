import { FIELDS, money, todayBogota } from "./crm.js";

export function organizations(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = (row.Compañia || "").trim().toUpperCase();
    const group = groups.get(key) || {
      key,
      name: row.Compañia || "Sin compañía",
      agreements: [],
    };
    group.agreements.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );
}
export function followups(rows, overdue = false, today = todayBogota()) {
  return rows
    .filter((r) => !r.archived_at)
    .flatMap((row) =>
      (row.actividades || [])
        .map((activity, index) => ({ ...activity, agreement: row, index }))
        .filter(
          (a) => !a.cumplida && (!overdue || (a.fecha && a.fecha < today)),
        ),
    )
    .sort((a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999"));
}
export function reportTables(rows, selection = null) {
  const selected =
    selection ||
    rows.flatMap((r) =>
      (r.actividades || []).map((a, index) => ({ ...a, index, agreement: r })),
    );
  return [
    {
      name: "Convenios",
      columns: ["Id", ...FIELDS, "Estado", "Actualizado"],
      data: rows.map((r) => [
        r.Id,
        ...FIELDS.map((k) => r[k] ?? ""),
        r.archived_at ? "Archivado" : "Activo",
        r.updated_at || "",
      ]),
    },
    {
      name: "Tarifas",
      columns: ["Convenio", "Compañía", "Producto", "Año", "Tarifa COP"],
      data: rows.flatMap((r) =>
        Object.entries(r.tarifa || {})
          .sort()
          .map(([year, value]) => [
            r.Id,
            r.Compañia,
            r.Producto,
            Number(year),
            Number(value),
          ]),
      ),
    },
    {
      name: "Seguimientos",
      columns: ["Convenio", "Compañía", "Producto", "Fecha", "Nota", "Estado"],
      data: selected.map((a) => [
        a.agreement.Id,
        a.agreement.Compañia,
        a.agreement.Producto,
        a.fecha || "",
        a.nota || "",
        a.cumplida ? "Completada" : "Pendiente",
      ]),
    },
  ];
}
export async function excelReport(rows, selection = null, grouped = false) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Oralhome";
  const tables = reportTables(rows, selection);
  if (grouped)
    tables.unshift({
      name: "Organizaciones",
      columns: ["Organización", "Convenios"],
      data: organizations(rows).map((g) => [g.name, g.agreements.length]),
    });
  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(table.columns);
    sheet.addRows(table.data);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0077B6" },
    };
    sheet.columns.forEach((col, i) => {
      col.width = i === 0 ? 12 : 28;
      col.alignment = { vertical: "top", wrapText: true };
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: table.columns.length },
    };
    if (table.name === "Tarifas") sheet.getColumn(5).numFmt = '"$" #,##0.00';
  }
  return workbook.xlsx.writeBuffer();
}
export async function pdfReport(
  rows,
  selection = null,
  title = "Convenios",
  grouped = false,
) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const table = (head, body, startY = 32) =>
    autoTable(doc, {
      head: [head],
      body,
      startY,
      margin: { top: 32, bottom: 16 },
      styles: { fontSize: 9, overflow: "linebreak", cellPadding: 2 },
      headStyles: { fillColor: [0, 119, 182] },
      rowPageBreak: "avoid",
    });
  if (grouped) {
    table(
      ["Organización", "Convenios", "Productos"],
      organizations(rows).map((g) => [
        g.name,
        g.agreements.length,
        g.agreements.map((r) => r.Producto || "Sin producto").join("\n"),
      ]),
    );
  } else if (selection) {
    table(
      ["Convenio", "Fecha", "Seguimiento"],
      selection.map((a) => [
        `${a.agreement.Compañia}\n${a.agreement.Producto || ""}`,
        a.fecha || "Sin fecha",
        a.nota || "Sin nota",
      ]),
    );
  } else {
    rows.forEach((r, i) => {
      if (i) doc.addPage();
      table(
        ["Campo", "Información"],
        [
          ["Convenio", `${r.Id} · ${r.Compañia}`],
          ["Producto", r.Producto || ""],
          ["Estado", r.archived_at ? "Archivado" : "Activo"],
          ["Actividad comercial", r.Actividad_comercial || ""],
          ["Gestión comercial", r.Fecha_Gestion_comercial || ""],
          ["Responsable", r.Responsable_cliente || ""],
          ["Teléfono", r.Telefono || ""],
          ["Correo", r.email_cliente || ""],
          ["Renovación", r.Mes_renovacion || ""],
          [
            "Tarifas COP",
            Object.entries(r.tarifa || {})
              .sort()
              .map(([y, v]) => `${y}: ${money.format(v)}`)
              .join("\n"),
          ],
          [
            "Seguimientos",
            (r.actividades || [])
              .map(
                (a) =>
                  `${a.cumplida ? "Completada" : "Pendiente"} · ${a.fecha || "Sin fecha"}\n${a.nota || "Sin nota"}`,
              )
              .join("\n\n") || "Sin seguimientos",
          ],
        ],
      );
    });
  }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setFontSize(15);
    doc.setTextColor(0, 80, 120);
    doc.text("CRM Oralhome", 14, 14);
    doc.setFontSize(10);
    doc.setTextColor(40);
    const count = grouped
      ? `${organizations(rows).length} organización(es)`
      : selection
        ? `${selection.length} seguimiento(s)`
        : `${rows.length} convenio(s)`;
    doc.text(`${title} · ${todayBogota()} · ${count}`, 14, 23);
    doc.setFontSize(8);
    doc.text(`Página ${page} de ${total}`, 196, 290, { align: "right" });
  }
  return doc.output("arraybuffer");
}
