import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import { createInvitedUser } from "./handler.js";
const origins = new Set([
  "https://crm-convenios-oralhome.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origins.has(origin)
      ? origin
      : "https://crm-convenios-oralhome.vercel.app",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const reply = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && !origins.has(origin))
    return reply({ error: "Origen no autorizado" }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return reply({ error: "Método no permitido" }, 405);
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token)
    return reply({ error: "Inicia sesión para crear usuarios." }, 401);
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const input = await request.json();
    const result = await createInvitedUser(input, token, {
      async authorize(jwt: string) {
        const { data, error } = await sb.auth.getUser(jwt);
        if (error || !data.user) return null;
        const { data: profile, error: profileError } = await sb
          .from("profiles")
          .select("id,role,is_active")
          .eq("id", data.user.id)
          .single();
        return !profileError &&
          profile?.is_active &&
          profile.role === "administrador"
          ? profile.id
          : null;
      },
      async invite(email: string, name: string) {
        const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
          data: { full_name: name },
          redirectTo: "https://crm-convenios-oralhome.vercel.app/?recovery=1",
        });
        return { id: data.user?.id, error };
      },
      async activate(id: string, actor: string, name: string, role: string) {
        const { error } = await sb.rpc("activate_crm_invited_user", {
          p_user: id,
          p_actor: actor,
          p_name: name,
          p_role: role,
        });
        if (error) throw error;
      },
    });
    return reply(result, result.status);
  } catch {
    return reply(
      {
        error:
          "No se pudo procesar la solicitud. Revisa los datos o inténtalo más tarde.",
      },
      400,
    );
  }
});
