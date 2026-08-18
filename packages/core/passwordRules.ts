/**
 * Password strength rules shared between client (live checklist in
 * AuthGate.tsx) and server (Zod schema for registerParticipant in
 * actions/index.ts). Defined once here so the two never drift apart —
 * the client shows a requirement as "met" only if the server would
 * actually accept it.
 */

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRuleCheck {
  id: "minLength" | "hasLetter" | "hasNumber";
  met: boolean;
}

export function checkPasswordRules(password: string): PasswordRuleCheck[] {
  return [
    { id: "minLength", met: password.length >= PASSWORD_MIN_LENGTH },
    { id: "hasLetter", met: /[a-zA-Z]/.test(password) },
    { id: "hasNumber", met: /[0-9]/.test(password) }
  ];
}

export function isPasswordValid(password: string): boolean {
  return checkPasswordRules(password).every((r) => r.met);
}
