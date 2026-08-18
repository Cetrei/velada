import { useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import { PAGES, checkPasswordRules, type PasswordRuleCheck } from "@velada/core";

type Step = "email" | "login" | "register" | "admin";
type StatusMessage = { type: "success" | "error"; text: string } | null;
type EmailCheckStatus = "idle" | "checking" | "new" | "existing" | "admin" | "invalid";

const copy = PAGES.inscripcion;

const PASSWORD_RULE_LABEL: Record<PasswordRuleCheck["id"], string> = {
  minLength: copy.passwordRequirementMinLength,
  hasLetter: copy.passwordRequirementLetter,
  hasNumber: copy.passwordRequirementNumber
};

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

  // Live email check: debounced ~500ms after the fighter stops typing,
  // mirrors the pattern used for the Riot ID check in
  // ParticipantProfileForm.tsx (checkRiotProfile). Drives the green
  // check / yellow spinner / red X icon inside the email field itself,
  // before they ever hit "Continuar". requestId discards stale responses
  // if the fighter keeps typing while an older check is still in flight.
  const [emailCheck, setEmailCheck] = useState<EmailCheckStatus>("idle");
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailCheckRequestId = useRef(0);

  useEffect(() => {
    if (step !== "email") return;
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);

    const trimmed = email.trim();
    if (!trimmed) {
      setEmailCheck("idle");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailCheck("invalid");
      return;
    }

    setEmailCheck("checking");
    const requestId = ++emailCheckRequestId.current;

    emailCheckTimer.current = setTimeout(async () => {
      try {
        const form = new FormData();
        form.set("email", trimmed);
        const { data, error } = await actions.checkEmailExists(form);
        if (requestId !== emailCheckRequestId.current) return;
        if (error) {
          setEmailCheck("invalid");
          return;
        }
        setEmailCheck(data.isAdmin ? "admin" : data.exists ? "existing" : "new");
      } catch {
        if (requestId === emailCheckRequestId.current) setEmailCheck("invalid");
      }
    }, 500);

    return () => {
      if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    };
  }, [email, step]);

  const passwordRules = checkPasswordRules(password);
  const passwordValid = passwordRules.every((r) => r.met);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  async function handleEmailContinue() {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setStatus({ type: "error", text: copy.errorEmailInvalid });
      return;
    }

    // El check en vivo (emailCheck) ya resolvio exists/isAdmin mientras el
    // usuario escribia — si ese resultado sigue vigente (mismo email, no
    // "checking"/"invalid"), se reusa en vez de volver a llamar
    // checkEmailExists una segunda vez al hacer click.
    if (emailCheck === "admin" || emailCheck === "existing" || emailCheck === "new") {
      setStep(emailCheck === "admin" ? "admin" : emailCheck === "existing" ? "login" : "register");
      return;
    }

    setStatus(null);
    setIsBusy(true);
    try {
      const form = new FormData();
      form.set("email", trimmed);
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
   * Redirects to the landing page on success, same as fighter login/
   * register below — the nav's "Mi Perfil" link (or, for admins, the
   * host-panel link shown from /mi-perfil) is how they get to editing
   * from there, not an automatic redirect out of /inscripcion.
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
      window.location.href = "/";
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
      window.location.href = "/";
    } catch (err) {
      setStatus({ type: "error", text: errorMessage(err) });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRegister() {
    if (!passwordValid) {
      setStatus({ type: "error", text: copy.passwordRequirementsTitle });
      return;
    }
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
      // Una cuenta recien creada todavia no tiene ficha de peleador
      // (saveOwnParticipant nunca corrio) — se manda a /mi-perfil
      // directo en vez de al landing, asi el registro no deja a nadie
      // a mitad de camino sin saber que le falta completar los datos
      // minimos. El login (arriba) si va al landing porque ya tiene
      // cuenta y probablemente ya tiene ficha tambien.
      window.location.href = "/mi-perfil";
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

  const emailContinueDisabled = isBusy || emailCheck === "checking" || emailCheck === "invalid" || emailCheck === "idle";

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
          <div className="relative mt-1">
            <input
              type="email"
              value={email}
              disabled={step !== "email"}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-lol-darkBg border border-lol-border rounded px-4 py-3 pr-10 text-white focus:border-lol-gold outline-none disabled:opacity-50"
              autoFocus
              autoComplete="email"
            />
            {step === "email" && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center" aria-hidden="true">
                <EmailCheckIcon status={emailCheck} />
              </span>
            )}
          </div>
          {step === "email" && <EmailCheckHint status={emailCheck} />}
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
              autoComplete="current-password"
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
                autoComplete="new-password"
              />
              <PasswordChecklist password={password} rules={passwordRules} allMet={passwordValid} />
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
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && (
                <p className={`text-xs mt-1.5 ${passwordsMatch ? "text-green-400" : "text-red-400"}`}>
                  {passwordsMatch ? copy.passwordMatchHint : copy.errorPasswordMismatch}
                </p>
              )}
            </label>
            <p className="text-xs text-slate-500">{copy.newAccountHint}</p>
          </>
        )}

        <button
          type="submit"
          disabled={
            isBusy ||
            (step === "email" && emailContinueDisabled) ||
            (step === "register" && (!passwordValid || !passwordsMatch))
          }
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

      <style>{`
        .auth-check-spinner {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid rgba(234, 179, 8, 0.3);
          border-top-color: #eab308;
          animation: authCheckSpin 0.7s linear infinite;
        }
        @keyframes authCheckSpin {
          to { transform: rotate(360deg); }
        }
        .password-rule-enter {
          animation: passwordRuleFade 0.15s ease-out;
        }
        @keyframes passwordRuleFade {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Green check / yellow spinner / red X next to the email field, same
 * visual language as RiotCheckIcon in ParticipantProfileForm.tsx. "invalid"
 * covers both a malformed address (client-side regex, instant) and a
 * failed checkEmailExists call (rare, e.g. offline) — either way there's
 * nothing to do but fix the email or retry, so one icon state covers both.
 */
function EmailCheckIcon({ status }: { status: EmailCheckStatus }) {
  if (status === "idle") return null;
  if (status === "checking") return <span className="auth-check-spinner" role="status" aria-label="Verificando..." />;
  if (status === "invalid") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f87171"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="status"
        aria-label="Email invalido"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4ade80"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="status"
      aria-label="Email valido"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function EmailCheckHint({ status }: { status: EmailCheckStatus }) {
  if (status === "idle" || status === "checking") {
    return status === "checking" ? <p className="text-xs mt-1.5 text-slate-500">{copy.emailCheckingHint}</p> : null;
  }
  if (status === "invalid") return <p className="text-xs mt-1.5 text-red-400">{copy.errorEmailInvalid}</p>;
  const text = status === "admin" ? copy.emailAdminHint : status === "existing" ? copy.emailExistingAccountHint : copy.emailNewAccountHint;
  return <p className="text-xs mt-1.5 text-green-400">{text}</p>;
}

/**
 * Shows only the requirements still pending, so the list shrinks as the
 * fighter types instead of always displaying all three (avoids clutter).
 * Once every rule is met it collapses to a single compact "valida" line
 * instead of an empty checklist. Nothing renders until the field has any
 * input, so a fresh empty password field isn't greeted with a wall of red.
 */
function PasswordChecklist({
  password,
  rules,
  allMet
}: {
  password: string;
  rules: PasswordRuleCheck[];
  allMet: boolean;
}) {
  if (password.length === 0) return null;

  if (allMet) {
    return (
      <p className="text-xs mt-1.5 text-green-400 flex items-center gap-1.5 password-rule-enter">
        <CheckDot met />
        {copy.passwordRequirementsMet}
      </p>
    );
  }

  const pending = rules.filter((r) => !r.met);

  return (
    <ul className="mt-1.5 space-y-1">
      {pending.map((rule) => (
        <li key={rule.id} className="text-xs text-slate-400 flex items-center gap-1.5 password-rule-enter">
          <CheckDot met={false} />
          {PASSWORD_RULE_LABEL[rule.id]}
        </li>
      ))}
    </ul>
  );
}

function CheckDot({ met }: { met: boolean }) {
  if (met) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#4ade80"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden="true" />;
}
