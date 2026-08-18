import { useState } from "react";
import { actions } from "astro:actions";
import { PAGES } from "@velada/core";

type Step = "email" | "login" | "register" | "admin";
type StatusMessage = { type: "success" | "error"; text: string } | null;

const copy = PAGES.inscripcion;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function AuthGate() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleEmailContinue() {
    if (!isValidEmail(email)) {
      setStatus({ type: "error", text: copy.errorEmailInvalid });
      return;
    }

    setStatus(null);
    setIsBusy(true);
    try {
      const form = new FormData();
      form.set("email", email);
      const { data, error } = await actions.checkEmailExists(form);
      if (error) {
        setStatus({ type: "error", text: errorMessage(error) });
        return;
      }
      if (data.isAdmin) {
        setStep("admin");
      } else {
        setStep(data.exists ? "login" : "register");
      }
    } catch (err) {
      setStatus({ type: "error", text: errorMessage(err) });
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * Admin emails (ADMIN_EMAILS) skip the password entirely — the shared
   * `login` action authenticates them by email alone. They still hit the
   * separate PANEL_PASSPHRASE gate once inside /gestion-roster-x9f2.
   */
  async function handleAdminLogin() {
    setStatus(null);
    setIsBusy(true);
    try {
      const form = new FormData();
      form.set("email", email);
      const { error } = await actions.login(form);
      if (error) {
        setStatus({ type: "error", text: errorMessage(error) });
        return;
      }
      window.location.reload();
    } catch (err) {
      setStatus({ type: "error", text: errorMessage(err) });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogin() {
    setStatus(null);
    setIsBusy(true);
    try {
      const form = new FormData();
      form.set("email", email);
      form.set("password", password);
      const { error } = await actions.loginParticipant(form);
      if (error) {
        setStatus({ type: "error", text: errorMessage(error) });
        return;
      }
      window.location.reload();
    } catch (err) {
      setStatus({ type: "error", text: errorMessage(err) });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRegister() {
    if (password !== confirmPassword) {
      setStatus({ type: "error", text: copy.errorPasswordMismatch });
      return;
    }

    setStatus(null);
    setIsBusy(true);
    try {
      const form = new FormData();
      form.set("email", email);
      form.set("password", password);
      const { error } = await actions.registerParticipant(form);
      if (error) {
        setStatus({ type: "error", text: errorMessage(error) });
        return;
      }
      window.location.reload();
    } catch (err) {
      setStatus({ type: "error", text: errorMessage(err) });
    } finally {
      setIsBusy(false);
    }
  }

  function handleChangeEmail() {
    setStep("email");
    setPassword("");
    setConfirmPassword("");
    setStatus(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === "email") handleEmailContinue();
    else if (step === "admin") handleAdminLogin();
    else if (step === "login") handleLogin();
    else handleRegister();
  }

  return (
    <div className="max-w-md mx-auto bg-lol-cardBg border border-lol-border p-6 rounded-xl">
      {status && (
        <div
          className={`text-sm p-3 rounded mb-4 ${
            status.type === "success"
              ? "bg-green-900/30 text-green-400 border border-green-800"
              : "bg-red-900/30 text-red-400 border border-red-800"
          }`}
        >
          {status.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-white">{copy.emailLabel}</span>
          <input
            type="email"
            value={email}
            disabled={step !== "email"}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-lol-darkBg border border-lol-border rounded px-4 py-3 text-white focus:border-lol-gold outline-none disabled:opacity-50"
            autoFocus
          />
        </label>

        {step === "admin" && (
          <p className="text-xs text-slate-500">
            Esta cuenta tiene acceso de host. Segui para entrar sin contrasena.
          </p>
        )}

        {step === "login" && (
          <label className="block">
            <span className="text-sm font-bold uppercase tracking-wide text-white">{copy.passwordLabel}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full bg-lol-darkBg border border-lol-border rounded px-4 py-3 text-white focus:border-lol-gold outline-none"
              autoFocus
            />
            <p className="text-xs text-slate-500 mt-2">{copy.existingAccountHint}</p>
          </label>
        )}

        {step === "register" && (
          <>
            <label className="block">
              <span className="text-sm font-bold uppercase tracking-wide text-white">{copy.passwordLabel}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full bg-lol-darkBg border border-lol-border rounded px-4 py-3 text-white focus:border-lol-gold outline-none"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold uppercase tracking-wide text-white">
                {copy.confirmPasswordLabel}
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full bg-lol-darkBg border border-lol-border rounded px-4 py-3 text-white focus:border-lol-gold outline-none"
              />
            </label>
            <p className="text-xs text-slate-500">{copy.newAccountHint}</p>
          </>
        )}

        <button
          type="submit"
          disabled={isBusy}
          className="w-full py-3 px-6 bg-gradient-to-r from-lol-gold to-yellow-600 hover:from-yellow-500 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-display font-bold uppercase tracking-wide rounded"
        >
          {step === "email"
            ? copy.continueCta
            : step === "admin"
              ? copy.loginCta
              : step === "login"
                ? copy.loginCta
                : copy.registerCta}
        </button>

        {step !== "email" && (
          <button
            type="button"
            disabled={isBusy}
            onClick={handleChangeEmail}
            className="w-full text-center text-sm text-lol-blue hover:underline disabled:opacity-50"
          >
            {copy.changeEmailCta}
          </button>
        )}
      </form>
    </div>
  );
}
