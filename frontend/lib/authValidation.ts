export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Yếu" | "Trung bình" | "Mạnh";
  missing: string[];
};

export type AuthValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      errors: string[];
    };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const dangerousSqlPattern = /('|--|;|\/\*|\*\/|\b(union|select|insert|update|delete|drop|alter|exec)\b)/i;
const controlCharactersPattern = /[\u0000-\u001F\u007F]/g;

/**
 * Normalizes and trims text that comes from authentication forms.
 * This reduces weird Unicode/control-character input before validation runs.
 */
export function sanitizeAuthText(value: string, maxLength = 160): string {
  // Security: normalize Unicode and remove control characters before validation to reduce spoofing/XSS payload tricks.
  return value.normalize("NFKC").replace(controlCharactersPattern, "").trim().slice(0, maxLength);
}

/**
 * Validates an email address for login/register forms.
 * It returns the normalized lowercase email so the rest of the app uses one consistent value.
 */
export function validateEmail(value: string): AuthValidationResult<string> {
  const email = sanitizeAuthText(value, 254).toLowerCase();
  const errors: string[] = [];

  if (!emailPattern.test(email)) {
    errors.push("Email chưa đúng định dạng.");
  }

  // Security: this client-side check is only a first line of defense; backend/database must still use parameterized queries.
  if (dangerousSqlPattern.test(email)) {
    errors.push("Email chứa ký tự không an toàn.");
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: email };
}

/**
 * Scores password strength for the UI progress bar.
 * This does not replace Firebase/backend rules; it is immediate feedback before submit.
 */
export function analyzePassword(password: string): PasswordStrength {
  const missing: string[] = [];

  if (password.length < 8) {
    missing.push("ít nhất 8 ký tự");
  }

  if (!/[a-z]/.test(password)) {
    missing.push("chữ thường");
  }

  if (!/[A-Z]/.test(password)) {
    missing.push("chữ hoa");
  }

  if (!/\d/.test(password)) {
    missing.push("số");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    missing.push("ký tự đặc biệt");
  }

  const score = Math.max(0, 4 - Math.min(4, missing.length)) as PasswordStrength["score"];
  const label = score >= 4 ? "Mạnh" : score >= 3 ? "Trung bình" : "Yếu";

  return {
    score,
    label,
    missing,
  };
}

/**
 * Enforces the frontend password policy before creating a Firebase account.
 * The original password is returned only when it passes all checks.
 */
export function validatePassword(password: string): AuthValidationResult<string> {
  const errors: string[] = [];
  const strength = analyzePassword(password);

  if (strength.missing.length) {
    errors.push(`Mật khẩu còn thiếu: ${strength.missing.join(", ")}.`);
  }

  // Security: reject obvious SQL/script fragments even before Firebase receives the value.
  if (dangerousSqlPattern.test(password) || /<[^>]*script/i.test(password)) {
    errors.push("Mật khẩu chứa mẫu ký tự không an toàn.");
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: password };
}

/**
 * Validates a display name and strips angle brackets to avoid rendering HTML-like text later.
 * The backend still treats the final Firebase token/user identity as the source of truth.
 */
export function validateDisplayName(value: string): AuthValidationResult<string> {
  const displayName = sanitizeAuthText(value, 80).replace(/[<>]/g, "");
  const errors: string[] = [];

  if (displayName.length < 2) {
    errors.push("Họ tên cần ít nhất 2 ký tự.");
  }

  if (dangerousSqlPattern.test(displayName)) {
    errors.push("Họ tên chứa ký tự không an toàn.");
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: displayName };
}
