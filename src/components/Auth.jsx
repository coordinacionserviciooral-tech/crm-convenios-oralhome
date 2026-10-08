import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/crm";

export function AuthForm({ message }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error)
        throw new Error(
          "No fue posible ingresar. Revisa el correo y la contraseña.",
        );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function recover() {
    if (!email.trim()) {
      setNotice("Escribe tu correo antes de solicitar la recuperación.");
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${location.origin}/?recovery=1` },
      );
      if (error) throw error;
      setNotice(
        "Si el correo tiene una cuenta, recibirás un enlace para crear una nueva contraseña.",
      );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <main className="login">
      <form className="card auth-card" onSubmit={submit}>
        <img
          className="logo"
          alt="Oralhome"
          src="/LOGO-ORAL-HOME SIN FONDO.png"
        />
        <h1>CRM de convenios</h1>
        <p className="muted">Ingresa con tu cuenta autorizada.</p>
        <label className="field">
          Correo
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {(notice || message) && (
          <p className="notice" role="status">
            {notice || message}
          </p>
        )}
        <button disabled={busy} className="btn primary wide">
          {busy ? "Procesando…" : "Ingresar"}
        </button>
        <button
          disabled={busy}
          type="button"
          className="btn ghost wide"
          onClick={recover}
        >
          Olvidé mi contraseña
        </button>
      </form>
    </main>
  );
}
export function PasswordForm({ recovery = false, onComplete, signOut }) {
  const [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const lock = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    if (password.length < 12) {
      setNotice("Usa al menos 12 caracteres.");
      return;
    }
    if (password !== repeat) {
      setNotice("Las contraseñas no coinciden.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setRepeat("");
      setDone(true);
      setNotice("Contraseña actualizada correctamente.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const form = (
    <form className="card auth-card" onSubmit={submit}>
      <h1>{recovery ? "Restablecer contraseña" : "Cambiar contraseña"}</h1>
      {!done && (
        <>
          <p className="muted">
            Usa al menos 12 caracteres y una contraseña exclusiva para esta
            cuenta.
          </p>
          <label className="field">
            Nueva contraseña
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            Confirmar contraseña
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
        </>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {done ? (
        <button type="button" className="btn primary" onClick={onComplete}>
          Volver al CRM
        </button>
      ) : (
        <button disabled={busy} className="btn primary">
          {busy ? "Guardando…" : "Guardar contraseña"}
        </button>
      )}{" "}
      {recovery && (
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={signOut}
        >
          Cerrar sesión
        </button>
      )}
    </form>
  );
  return recovery ? <main className="login">{form}</main> : form;
}
