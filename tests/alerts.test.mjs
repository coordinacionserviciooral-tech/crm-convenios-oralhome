import test from "node:test";
import assert from "node:assert/strict";
import {
  bogotaDate,
  buildAlerts,
  subtractWeekdays,
} from "../supabase/functions/power-automate-alerts/alerts.js";
import { deliverAlert } from "../supabase/functions/power-automate-alerts/delivery.js";
const row = {
  Id: 1,
  Compañia: "<script>bad</script>",
  Producto: "Plan",
  Responsable_cliente: "Ana & Luis",
  Mes_renovacion: "Enero",
};
test("renewal rolls over to next year and matches 8/3/1 calendar day notices", async () => {
  const alerts = await buildAlerts(
    [row],
    "2026-12-24",
    "am",
    "test@example.com",
    "crm@example.com",
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].date, "2027-01-01");
  assert.equal(alerts[0].days, 8);
  assert.equal(alerts[0].key, "1:renovacion:2027-01-01:8:am");
  assert.equal(
    (
      await buildAlerts(
        [row],
        "2026-12-29",
        "am",
        "test@example.com",
        "crm@example.com",
      )
    )[0].days,
    3,
  );
  assert.equal(
    (
      await buildAlerts(
        [row],
        "2026-12-31",
        "am",
        "test@example.com",
        "crm@example.com",
      )
    )[0].days,
    1,
  );
});
test("preserves original month notices and excludes archived, completed and invalid activity dates", async () => {
  assert.equal(
    (
      await buildAlerts(
        [row],
        "2026-11-01",
        "am",
        "test@example.com",
        "crm@example.com",
      )
    )[0].type,
    "renovacion_mensual",
  );
  const source = {
    ...row,
    archived_at: "2026-01-01",
    Fecha_Gestion_comercial: "2026-10-15",
  };
  assert.deepEqual(
    await buildAlerts([source], "2026-10-07", "am", "a@b.com", "a@b.com"),
    [],
  );
  const activities = [
    { fecha: "2026-10-15", cumplida: true },
    { fecha: "2026-02-30" },
    { fecha: "bad" },
  ];
  assert.deepEqual(
    await buildAlerts(
      [{ Id: 2, actividades: activities }],
      "2026-10-05",
      "am",
      "a@b.com",
      "a@b.com",
    ),
    [],
  );
});
test("activity notices use weekdays and stable identity when activities are reordered", async () => {
  assert.equal(subtractWeekdays("2026-10-15", 8), "2026-10-05");
  const a = { fecha: "2026-10-15", nota: "Pendiente", id: "act-1" },
    b = { fecha: "2026-10-15", nota: "Otro", id: "act-2" };
  const one = await buildAlerts(
    [{ ...row, actividades: [a, b] }],
    "2026-10-05",
    "am",
    "a@b.com",
    "a@b.com",
  );
  const two = await buildAlerts(
    [{ ...row, actividades: [b, a] }],
    "2026-10-05",
    "am",
    "a@b.com",
    "a@b.com",
  );
  assert.deepEqual(one.map((a) => a.key).sort(), two.map((a) => a.key).sort());
  assert.equal(one.length, 2);
  const deduped = await buildAlerts(
    [{ ...row, actividades: [a, a] }],
    "2026-10-05",
    "am",
    "a@b.com",
    "a@b.com",
  );
  assert.equal(deduped.length, 1);
});
test("HTML is escaped and morning/afternoon are separately deduplicated", async () => {
  const am = (
    await buildAlerts([row], "2026-12-24", "am", "a@b.com", "a@b.com")
  )[0];
  const pm = (
    await buildAlerts([row], "2026-12-24", "pm", "a@b.com", "a@b.com")
  )[0];
  assert.ok(!am.payload.html.includes("<script>"));
  assert.ok(am.payload.html.includes("&lt;script&gt;"));
  assert.notEqual(am.key, pm.key);
  assert.equal(bogotaDate(new Date("2026-10-08T02:00:00Z")), "2026-10-07");
});
test("failed delivery remains retryable; successful retry records actual confirmation only once", async () => {
  let state = "pending",
    attempts = 0,
    sendCalls = 0;
  const adapter = {
    claim: async () =>
      state === "sent" ? null : { id: 1, attempts: ++attempts },
    send: async () => {
      if (++sendCalls === 1) throw new Error("Provider offline");
      return { id: "mail-1" };
    },
    finish: async (_, patch) => {
      state = patch.status;
      if (state === "failed") assert.equal(patch.sent_at, null);
      if (state === "sent") assert.equal(patch.provider_id, "mail-1");
    },
  };
  assert.equal(await deliverAlert({}, adapter), "failed");
  assert.equal(state, "failed");
  assert.equal(await deliverAlert({}, adapter), "sent");
  assert.equal(await deliverAlert({}, adapter), "skipped");
  assert.equal(sendCalls, 2);
});
