// Pure orchestration: database and provider adapters can be tested without sending email.
export async function deliverAlert(alert, adapter) {
  const claim = await adapter.claim(alert);
  if (!claim) return "skipped";
  let accepted = false;
  try {
    const result = await adapter.send(claim);
    accepted = true;
    await adapter.finish(claim, {
      status: "sent",
      provider_id: result.id,
      last_error: null,
      sent_at: new Date().toISOString(),
    });
    return "sent";
  } catch (error) {
    await adapter.finish(claim, {
      status:
        error.uncertain || (accepted && claim.payload?.provider === "emailjs")
          ? "uncertain"
          : "failed",
      last_error: String(error.message || error).slice(0, 500),
      sent_at: null,
    });
    return error.uncertain ||
      (accepted && claim.payload?.provider === "emailjs")
      ? "uncertain"
      : "failed";
  }
}
