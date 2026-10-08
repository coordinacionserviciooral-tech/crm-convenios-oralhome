import test from "node:test";
import assert from "node:assert/strict";
import {
  agreementPayload,
  agreementsCsv,
  csvCell,
  normalizeAgreement,
  pendingActivities,
  todayBogota,
  validDate,
  visibleAgreements,
} from "../src/lib/crm.js";
const row = {
  Id: 1,
  Compañia: "Compañía de prueba",
  Producto: "Plan básico",
  tarifa: { 2017: 10, 2026: 123.5 },
  actividades: [
    {
      id: "original",
      fecha: "2026-10-10",
      nota: "Nota",
      cumplida: false,
      custom: "conservar",
    },
  ],
};
test("payload retains tariffs and activity metadata; excludes database audit fields", () => {
  const payload = agreementPayload({
    ...row,
    updated_by: "spoof",
    updated_at: "spoof",
    archived_at: "spoof",
    created_by: "spoof",
    Fecha_Gestion_comercial: "",
  });
  assert.equal(payload.Fecha_Gestion_comercial, null);
  assert.deepEqual(payload.tarifa, row.tarifa);
  assert.deepEqual(payload.actividades, row.actividades);
  for (const key of [
    "Id",
    "updated_at",
    "updated_by",
    "created_by",
    "archived_at",
  ])
    assert.ok(!(key in payload));
  assert.deepEqual(row.actividades[0], payload.actividades[0]);
});
test("invalid tariffs, empty company, invalid email and impossible dates are rejected", () => {
  for (const patch of [
    { Compañia: " " },
    { tarifa: { 2026: -1 } },
    { tarifa: { 2026: Infinity } },
    { Fecha_Gestion_comercial: "2026-02-30" },
    { email_cliente: "malformed" },
    { actividades: [{ fecha: "2026-02-30" }] },
  ])
    assert.throws(() => agreementPayload({ ...row, ...patch }));
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2025-02-29"), false);
});
test("search covers products and contacts, ignores accents, and shares archive filter with exports", () => {
  const rows = [row, { ...row, Id: 2, archived_at: "2026-01-01" }];
  assert.deepEqual(
    visibleAgreements(rows, "BASICO").map((r) => r.Id),
    [1],
  );
  assert.deepEqual(
    visibleAgreements(rows, "compania", "archivados").map((r) => r.Id),
    [2],
  );
  assert.equal(visibleAgreements(rows, "", "todos").length, 2);
});
test("CSV retains full tariffs and activities, escapes quotes and guards formula execution", () => {
  const csv = agreementsCsv([row]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes("Tarifa 2017"));
  assert.ok(csv.includes("original"));
  assert.equal(csvCell('"quoted"'), '"""quoted"""');
  for (const input of ["=1+1", "+123", "@cmd", "-12", "  =cmd"])
    assert.ok(csvCell(input).startsWith("\"'"));
});
test("Colombia date remains correct at UTC midnight; pending activities are sorted without mutation", () => {
  assert.equal(todayBogota(new Date("2026-10-08T01:00:00Z")), "2026-10-07");
  const activities = [
    { fecha: "2026-11-01" },
    { fecha: "2026-10-01" },
    { fecha: "2026-09-01", cumplida: true },
  ];
  assert.deepEqual(
    pendingActivities({ actividades: activities }).map((a) => a.fecha),
    ["2026-10-01", "2026-11-01"],
  );
  assert.equal(activities[0].fecha, "2026-11-01");
  assert.deepEqual(normalizeAgreement({ tarifa: null, actividades: null }), {
    tarifa: {},
    actividades: [],
  });
});
