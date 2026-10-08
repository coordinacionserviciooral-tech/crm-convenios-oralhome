import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import { bogotaDate, buildAlerts, buildDigest } from "./alerts.js";
import { deliverAlert } from "./delivery.js";
import { sendMessage } from "./provider.js";

type Alert = {
  key: string;
  agreement_id: number | null;
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
  if (!["am", "pm"].includes(slot))
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
      recipient = "coordinadordeservicio@oralhome.com.co";
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
    const today = bogotaDate();
    const details = await buildAlerts(rows, today, slot, recipient, from);
    // Failed summaries are reconsidered only at the next authorized schedule.
    const { data: failed, error: failedError } = await sb
      .from("alert_log")
      .select("id,alert_key,payload,status")
      .in("status", ["failed", "pending"])
      .order("id", { ascending: false })
      .limit(200);
    if (failedError) throw failedError;
    for (const entry of failed || []) {
      for (const old of entry.payload?.items || []) {
        const current = rows.find((row) => row.Id === old.agreement_id);
        if (!current) continue;
        const refreshed = await buildAlerts(
          [current],
          old.payload.due_date,
          old.slot,
          recipient,
          from,
        );
        const relevant = refreshed.find((item) => item.key === old.key);
        if (
          relevant &&
          !details.some(
            (item) =>
              item.agreement_id === relevant.agreement_id &&
              item.type === relevant.type &&
              item.date === relevant.date &&
              item.days === relevant.days,
          )
        )
          details.push(relevant);
      }
    }
    const digest = buildDigest(details, today, slot, recipient, from);
    if (options.dry_run === true)
      return json({
        ok: true,
        dry_run: true,
        agreements: rows.length,
        scheduled: details.length,
        emails: digest ? 1 : 0,
        recipient,
        slot,
        provider,
      });
    // Prevent authenticated manual invocations from sending outside the exact scheduled minute.
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
    if (localTime !== (slot === "am" ? "08:00" : "15:00"))
      return json({
        ok: true,
        skipped: true,
        reason: "Fuera del horario de envío",
      });
    const alerts: Alert[] = digest ? [digest] : [];
    for (const alert of alerts) alert.payload.provider = provider;
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
    if (counts.sent || !alerts.length) {
      const superseded = (failed || [])
        .filter(
          (entry) => entry.payload?.items && entry.alert_key !== digest?.key,
        )
        .map((entry) => entry.id);
      if (superseded.length) {
        const { error } = await sb
          .from("alert_log")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .in("id", superseded)
          .in("status", ["failed", "pending"]);
        if (error) throw error;
      }
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
