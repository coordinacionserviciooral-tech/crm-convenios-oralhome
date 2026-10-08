import test from "node:test";
import assert from "node:assert/strict";
import {
  organizations,
  followups,
  excelReport,
  pdfReport,
} from "../src/lib/reports.js";
import {
  documentPath,
  validateDocument,
  MAX_DOCUMENT_SIZE,
} from "../src/lib/documents.js";
const rows = [
  {
    Id: 1,
    Compañia: "Álfa",
    Producto: "Contrato uno",
    tarifa: { 2026: 12345.5 },
    actividades: [
      { fecha: "2026-10-01", nota: "Vencido", cumplida: false },
      { fecha: "", nota: "Pendiente sin fecha", cumplida: false },
      { fecha: "2026-10-20", nota: "Hecho", cumplida: true },
    ],
  },
  {
    Id: 2,
    Compañia: " ÁLFA ",
    Producto: "Contrato dos",
    tarifa: { 2027: 10 },
    actividades: [{ fecha: "2026-11-01", nota: "Futuro", cumplida: false }],
  },
  {
    Id: 3,
    Compañia: "Archivada",
    archived_at: "2026-09-01",
    actividades: [{ fecha: "2026-10-01", nota: "No activo", cumplida: false }],
  },
];
test("indicator drilldowns preserve each pending record, including undated items, and exclude archived agreements", () => {
  assert.equal(organizations(rows.slice(0, 2)).length, 1);
  assert.equal(organizations(rows.slice(0, 2))[0].agreements.length, 2);
  assert.equal(followups(rows).length, 3);
  assert.equal(followups(rows, true, "2026-10-07").length, 1);
  assert.equal(followups(rows).at(-1).nota, "Pendiente sin fecha");
});
test("Excel round-trip preserves numeric tariffs, all activities, accents and literal formula-like text", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await excelReport([
      { ...rows[0], Producto: '=HYPERLINK("https://example.com")' },
    ]),
  );
  assert.equal(workbook.getWorksheet("Convenios").getCell("B2").value, "Álfa");
  const product = workbook.getWorksheet("Convenios").getCell("D2");
  assert.equal(product.type, ExcelJS.ValueType.String);
  assert.equal(workbook.getWorksheet("Tarifas").getCell("E2").value, 12345.5);
  assert.equal(workbook.getWorksheet("Seguimientos").rowCount, 4);
  await workbook.xlsx.load(await excelReport(rows.slice(0, 2), null, true));
  assert.equal(workbook.getWorksheet("Organizaciones").rowCount, 2);
  assert.equal(workbook.getWorksheet("Organizaciones").getCell("B2").value, 2);
});
test("PDF handles long notes across pages and selected followups", async () => {
  const detailed = await pdfReport([
    { ...rows[0], Actividad_comercial: "Información extensa. ".repeat(800) },
  ]);
  const pdf = Buffer.from(detailed).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length > 1);
  const selected = await pdfReport(
    rows.slice(0, 2),
    followups(rows),
    "Seguimientos pendientes",
  );
  assert.ok(
    Buffer.from(selected).toString("latin1").includes("Pendiente sin fecha"),
  );
});
test("document keys separate agreements and duplicate names; invalid and oversized files are rejected", () => {
  const key = documentPath(
    7,
    "Contrato / compañía.pdf",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.match(key, /^7\/[a-f0-9-]+\/Contrato___compania\.pdf$/);
  assert.notEqual(
    key,
    documentPath(
      8,
      "Contrato / compañía.pdf",
      "00000000-0000-4000-8000-000000000001",
    ),
  );
  assert.throws(
    () => validateDocument({ name: "vacío.pdf", size: 0 }),
    /contenido/,
  );
  assert.throws(
    () => validateDocument({ name: "grande.pdf", size: MAX_DOCUMENT_SIZE + 1 }),
    /25 MB/,
  );
});
