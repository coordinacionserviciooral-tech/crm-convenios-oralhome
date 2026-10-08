import { useCallback, useEffect, useRef, useState } from "react";
import { configurationError, supabase } from "./lib/supabase";
import { errorMessage } from "./lib/crm";
import { AuthForm, PasswordForm } from "./components/Auth";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [auth, setAuth] = useState({
    session: null,
    ready: false,
    recovery:
      location.hash.includes("type=recovery") ||
      location.hash.includes("type=invite") ||
      new URLSearchParams(location.search).get("recovery") === "1",
  });
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [profileReady, setProfileReady] = useState(false);
  const currentUser = useRef(null);
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      if (currentUser.current !== session?.user.id) {
        setProfile(null);
        setProfileReady(false);
        currentUser.current = session?.user.id;
      }
      setAuth((old) => ({
        session,
        ready: true,
        recovery:
          event === "PASSWORD_RECOVERY" ||
          (event !== "SIGNED_OUT" && old.recovery),
      }));
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!live) return;
      if (error) setMessage(errorMessage(error));
      setAuth((old) => ({ ...old, session: data.session, ready: true }));
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);
  const userId = auth.session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    async function refresh() {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (!live) return;
      setProfileReady(true);
      if (error) {
        setProfile(null);
        setMessage("No se pudo verificar tu acceso. " + errorMessage(error));
        return;
      }
      if (!data.is_active) {
        setProfile(null);
        setMessage("Tu acceso está desactivado. Contacta al administrador.");
        await supabase.auth.signOut();
        return;
      }
      setMessage("");
      setProfile(data);
    }
    void refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [userId, retry]);
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(errorMessage(error));
  }, []);
  if (configurationError)
    return (
      <main className="login">
        <section className="card">
          <h1>Configurar CRM Oralhome</h1>
          <p role="alert">{configurationError}</p>
        </section>
      </main>
    );
  if (!auth.ready)
    return (
      <main className="login">
        <p className="card" role="status">
          Verificando sesión…
        </p>
      </main>
    );
  if (auth.session && auth.recovery)
    return (
      <PasswordForm
        recovery
        onComplete={() => {
          history.replaceState(null, "", location.pathname);
          setAuth((a) => ({ ...a, recovery: false }));
        }}
        signOut={signOut}
      />
    );
  if (!auth.session) return <AuthForm message={message} />;
  if (!profile)
    return (
      <main className="login">
        <section className="card">
          <h1>CRM Oralhome</h1>
          <p role={message ? "alert" : "status"}>
            {message || "Verificando permisos…"}
          </p>
          {profileReady && (
            <button
              className="btn primary"
              onClick={() => setRetry((r) => r + 1)}
            >
              Reintentar
            </button>
          )}{" "}
          <button className="btn ghost" onClick={signOut}>
            Cerrar sesión
          </button>
        </section>
      </main>
    );
  return <Dashboard key={userId} profile={profile} signOut={signOut} />;
}
