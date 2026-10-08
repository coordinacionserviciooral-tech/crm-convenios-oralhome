import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configurationError =
  !url || !key || url.includes("TU-PROYECTO") || key.includes("REEMPLAZAR")
    ? "Falta configurar la conexión del CRM. Define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY y reinicia la aplicación."
    : "";
export const supabase = configurationError
  ? null
  : createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
