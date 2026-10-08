export async function sendMessage(claim, config, request = fetch) {
  const provider = claim.payload.provider || config.provider;
  const emailjs = provider === "emailjs";
  const endpoint = emailjs
    ? "https://api.emailjs.com/api/v1.0/email/send"
    : "https://api.resend.com/emails";
  const message = emailjs
    ? {
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        ...(config.privateKey ? { accessToken: config.privateKey } : {}),
        template_params: claim.payload.template_params,
      }
    : {
        from: claim.payload.from,
        to: claim.payload.to,
        subject: claim.payload.subject,
        html: claim.payload.html,
      };
  const headers = emailjs
    ? { "Content-Type": "application/json" }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Idempotency-Key": `crm-${claim.alert_key}`,
      };
  let response;
  try {
    response = await request(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(message),
    });
  } catch (cause) {
    const error = new Error(
      "No se recibió confirmación del proveedor de correo",
      { cause },
    );
    error.uncertain = emailjs;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      `${emailjs ? "EmailJS" : "Resend"} HTTP ${response.status}`,
    );
    error.uncertain = emailjs && response.status >= 500;
    throw error;
  }
  if (emailjs) return { id: `emailjs:${claim.alert_key}` };
  const result = await response.json();
  if (!result.id) throw new Error("Proveedor sin confirmación de envío");
  return result;
}
