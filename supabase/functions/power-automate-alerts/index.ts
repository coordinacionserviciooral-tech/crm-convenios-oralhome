import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import { bogotaDate, buildAlerts } from "./alerts.js";
import { deliverAlert } from "./delivery.js";
import { sendMessage } from "./provider.js";

type Alert = {
  key: string;
  agreement_id: number;
  type: string;
  date: string;
  days: number;
  slot: string;
  recipient: string;
  payload: Record<string, unknown>;
};
type Claim = {
  id: number;
  alert_key: string;
  attempts: number;
  payload: Record<string, unknown>;
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function secret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta configurar ${name}`);
  return value;
}
async function secretDigest(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function matchesDigest(x: string, y: string) {
  let diff = 0;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Método no permitido" }, 405);
  const suppliedSecret = request.headers.get("x-cron-secret");
  if (!suppliedSecret) return json({ error: "No autorizado" }, 401);
  const slot = request.headers.get("x-run-slot") || "am";
  if (!["am", "pm", "retry"].includes(slot))
    return json({ error: "Horario inválido" }, 400);
  try {
    const options = await request.json().catch(() => ({}));
    const sb = createClient(
      secret("SUPABASE_URL"),
      secret("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const { data: vaultDigest, error: authError } = await sb.rpc(
      "crm_cron_secret_digest",
    );
    if (authError) throw authError;
    const configuredSecret = Deno.env.get("CRON_SECRET");
    const expectedDigest =
      vaultDigest ||
      (configuredSecret ? await secretDigest(configuredSecret) : null);
    if (!expectedDigest) return json({ error: "Servicio sin configurar" }, 503);
    if (!matchesDigest(await secretDigest(suppliedSecret), expectedDigest))
      return json({ error: "No autorizado" }, 401);
    const provider = Deno.env.get("RESEND_API_KEY") ? "resend" : "emailjs";
    const config =
      provider === "resend"
        ? { provider, apiKey: secret("RESEND_API_KEY") }
        : {
            provider,
            serviceId: secret("EMAILJS_SERVICE_ID"),
            templateId: secret("EMAILJS_TEMPLATE_ID"),
            publicKey: secret("EMAILJS_PUBLIC_KEY"),
            privateKey: Deno.env.get("EMAILJS_PRIVATE_KEY"),
          };
    const from = provider === "resend" ? secret("ALERT_FROM_EMAIL") : "",
      recipient =
        Deno.env.get("ALERT_TO_EMAIL") ||
        "coordinadordeservicio@oralhome.com.co";
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await sb
        .from("Aliados")
        .select("*")
        .is("archived_at", null)
        .order("Id")
        .range(offset, offset + 499);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 500) break;
    }
    const alerts: Alert[] =
      slot === "retry"
        ? []
        : await buildAlerts(rows, bogotaDate(), slot, recipient, from);
    // Retry only within 23 hours: Resend retains idempotency keys for 24 h.
    const cutoff = new Date(Date.now() - 23 * 3600000).toISOString();
    const { data: queued, error: queuedError } = await sb
      .from("alert_log")
      .select("*")
      .in("status", ["pending", "failed", "processing"])
      .lt("attempts", 12)
      .order("id")
      .limit(200);
    if (queuedError) throw queuedError;
    if (options.dry_run === true)
      return json({
        ok: true,
        dry_run: true,
        agreements: rows.length,
        scheduled: alerts.length,
        queued: queued?.length || 0,
        slot,
        provider,
      });
    for (const alert of alerts) alert.payload.provider = provider;
    const activeIds = new Set(rows.map((row) => row.Id));
    for (const entry of queued || []) {
      if (!entry.payload || alerts.some((a) => a.key === entry.alert_key))
        continue;
      const expired =
        !entry.payload.queued_at || entry.payload.queued_at < cutoff;
      const current = rows.find((row) => row.Id === entry.agreement_id);
      const stillRelevant =
        current &&
        entry.payload.due_date &&
        (
          await buildAlerts(
            [current],
            entry.payload.due_date,
            entry.run_slot,
            entry.recipient,
            entry.payload.from || "",
          )
        ).some((alert) => alert.key === entry.alert_key);
      if (!activeIds.has(entry.agreement_id) || expired || !stillRelevant) {
        const { error } = await sb
          .from("alert_log")
          .update({
            status: expired ? "expired" : "cancelled",
            last_error: expired
              ? "Reintento requiere revisión manual después de 23 horas"
              : "Convenio archivado o seguimiento completado/cambiado",
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.id)
          .eq("attempts", entry.attempts);
        if (error) throw error;
        continue;
      }
      alerts.push({
        key: entry.alert_key,
        agreement_id: entry.agreement_id,
        type: entry.alert_type,
        date: entry.scheduled_for,
        days: entry.days_before,
        slot: entry.run_slot,
        recipient: entry.recipient,
        payload: entry.payload,
      });
    }
    const adapter = {
      async claim(alert: Alert) {
        const { data, error } = await sb.rpc("claim_crm_alert", {
          p_key: alert.key,
          p_agreement: alert.agreement_id,
          p_type: alert.type,
          p_date: alert.date,
          p_days: alert.days,
          p_slot: alert.slot,
          p_recipient: alert.recipient,
          p_payload: alert.payload,
        });
        if (error) throw error;
        return data as Claim | null;
      },
      async send(claim: Claim) {
        if (claim.payload.provider === "emailjs")
          await new Promise((resolve) => setTimeout(resolve, 1100));
        return await sendMessage(claim, config);
      },
      async finish(claim: Claim, patch: Record<string, unknown>) {
        const { data, error } = await sb
          .from("alert_log")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", claim.id)
          .eq("attempts", claim.attempts)
          .select("id");
        if (error || !data?.length)
          throw new Error("No se pudo confirmar el estado de la alerta");
      },
    };
    if (alerts.length) {
      const { error } = await sb.from("alert_log").upsert(
        alerts.map((alert) => ({
          alert_key: alert.key,
          agreement_id: alert.agreement_id,
          alert_type: alert.type,
          scheduled_for: alert.date,
          days_before: alert.days,
          run_slot: alert.slot,
          recipient: alert.recipient,
          payload: alert.payload,
          status: "pending",
        })),
        { onConflict: "alert_key", ignoreDuplicates: true },
      );
      if (error) throw error;
    }
    const counts = { sent: 0, failed: 0, uncertain: 0, skipped: 0 };
    for (const alert of alerts.slice(0, 40)) {
      const result = await deliverAlert(alert, adapter);
      counts[result as keyof typeof counts]++;
    }
    return json({
      ok: counts.failed === 0 && counts.uncertain === 0,
      ...counts,
      pending: Math.max(0, alerts.length - 40),
    });
  } catch (error) {
    console.error(
      "send-alerts failed:",
      error instanceof Error ? error.message : "Error interno",
    );
    return json(
      {
        error: "Error al procesar alertas. Revisa los registros del servidor.",
      },
      500,
    );
  }
});
