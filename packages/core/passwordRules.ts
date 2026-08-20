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
