"use client";

import { Bike, Check, Eye, EyeOff, KeyRound, LockKeyhole, Mail, Moon, ShieldCheck, Sun, UserRound, X } from "lucide-react";
import { FormEvent, type CSSProperties, useEffect, useMemo, useState } from "react";

import { login, loginWithApple, loginWithGoogle, registerWithEmail, requestPasswordReset, type ApiUser } from "@/lib/api";
import { analyzePassword, sanitizeAuthText, validateDisplayName, validateEmail, validateOtp, validatePassword } from "@/lib/authValidation";

type AuthMode = "login" | "register";

type AuthScreenProps = {
  theme: "light" | "dark";
  onAuthenticated: (user: ApiUser) => void;
  onThemeToggle: () => void;
};

export function AuthScreen({ theme, onAuthenticated, onThemeToggle }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaChecked, setCaptchaChecked] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [pendingMfaUser, setPendingMfaUser] = useState<ApiUser | null>(null);
  const [otp, setOtp] = useState("");

  const passwordStrength = useMemo(() => analyzePassword(password), [password]);
  const isLocked = lockUntil !== null && lockUntil > now;
  const lockSecondsLeft = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (!isLocked) {
      return;
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(intervalId);
  }, [isLocked]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setAuthError(null);
    setResetSent(false);
    setOtp("");
  }

  function registerFailedAttempt() {
    const nextCount = failedAttempts + 1;
    setFailedAttempts(nextCount);

    if (nextCount >= 3) {
      setCaptchaRequired(true);
    }

    if (nextCount >= 5) {
      setLockUntil(Date.now() + 60_000);
    }
  }

  function resetFailedAttempts() {
    setFailedAttempts(0);
    setCaptchaRequired(false);
    setCaptchaChecked(false);
    setLockUntil(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLocked) {
      setAuthError(`Tài khoản đang bị khóa tạm thời. Thử lại sau ${lockSecondsLeft} giây.`);
      return;
    }

    const safeEmail = validateEmail(email);
    const safePassword = mode === "register" ? validatePassword(password) : { ok: true as const, value: password };
    const errors: string[] = [];

    if (!safeEmail.ok) {
      errors.push(...safeEmail.errors);
    }

    if (!safePassword.ok) {
      errors.push(...safePassword.errors);
    }

    if (mode === "register") {
      const safeDisplayName = validateDisplayName(displayName);

      if (!safeDisplayName.ok) {
        errors.push(...safeDisplayName.errors);
      }

      if (password !== confirmPassword) {
        errors.push("Mật khẩu xác nhận chưa khớp.");
      }
    }

    if (captchaRequired && !captchaChecked) {
      errors.push("Vui lòng hoàn tất bước xác minh chống đăng nhập tự động.");
    }

    if (errors.length) {
      setAuthError(errors[0] ?? "Thông tin chưa hợp lệ.");
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      // Security: only sanitized/validated values reach Firebase; backend still re-verifies the Firebase ID token.
      const user =
        mode === "register"
          ? await registerWithEmail({
              displayName: validateDisplayName(displayName).ok ? sanitizeAuthText(displayName, 80).replace(/[<>]/g, "") : "",
              email: safeEmail.ok ? safeEmail.value : "",
              password,
              remember: rememberMe,
            })
          : await login(safeEmail.ok ? safeEmail.value : "", password, rememberMe);

      resetFailedAttempts();
      setPendingMfaUser(user);
    } catch {
      registerFailedAttempt();
      setAuthError(mode === "register" ? "Không đăng ký được. Kiểm tra lại thông tin hoặc thử email khác." : "Đăng nhập thất bại. Kiểm tra lại email hoặc mật khẩu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSocialLogin(provider: "google" | "apple") {
    if (isLocked) {
      setAuthError(`Đang khóa tạm thời. Thử lại sau ${lockSecondsLeft} giây.`);
      return;
    }

    if (captchaRequired && !captchaChecked) {
      setAuthError("Vui lòng hoàn tất bước xác minh chống đăng nhập tự động.");
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      const user = provider === "google" ? await loginWithGoogle(rememberMe) : await loginWithApple(rememberMe);
      resetFailedAttempts();
      setPendingMfaUser(user);
    } catch {
      registerFailedAttempt();
      setAuthError(provider === "apple" ? "Apple Login chưa sẵn sàng hoặc chưa bật trong Firebase Console." : "Đăng nhập Google thất bại.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    const safeEmail = validateEmail(email);

    if (!safeEmail.ok) {
      setAuthError("Nhập email hợp lệ trước khi khôi phục mật khẩu.");
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      // Security: Firebase sends the reset link; the app never handles raw password reset tokens.
      await requestPasswordReset(safeEmail.value);
      setResetSent(true);
    } catch {
      setAuthError("Chưa gửi được email khôi phục. Hãy thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOtpConfirm() {
    const checkedOtp = validateOtp(otp);

    if (!checkedOtp.ok) {
      setAuthError(checkedOtp.errors[0] ?? "Mã OTP chưa hợp lệ.");
      return;
    }

    if (pendingMfaUser) {
      // Security: this is the UI handoff point for real Firebase MFA/backend OTP verification in production.
      onAuthenticated(pendingMfaUser);
      setPendingMfaUser(null);
      setOtp("");
      setAuthError(null);
    }
  }

  const passwordInputType = showPassword ? "text" : "password";
  const confirmPasswordInputType = showConfirmPassword ? "text" : "password";

  return (
    <main className="auth-page">
      <section className="auth-hero" aria-label="TrailLedger security">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            <Bike size={22} />
          </div>
          <div>
            <p>TrailLedger</p>
            <span>Không gian chuyến đi bảo mật</span>
          </div>
        </div>

        <div className="auth-hero-copy">
          <span className="eyebrow">Travel group security</span>
          <h1>Đăng nhập an toàn cho nhóm đi đường dài.</h1>
          <p>Firebase Auth, kiểm tra đầu vào, chống brute-force ở giao diện và sẵn sàng nối MFA thật khi triển khai production.</p>
        </div>

        <div className="auth-security-list" aria-label="Security controls">
          <span><Check size={15} /> RBAC theo phòng</span>
          <span><Check size={15} /> Token không tự lưu localStorage</span>
          <span><Check size={15} /> OTP-ready flow</span>
        </div>
      </section>

      <section className="auth-panel-zone" aria-label="Authentication form">
        <button className="icon-button auth-theme-button" type="button" title="Đổi giao diện" aria-label="Đổi giao diện" onClick={onThemeToggle}>
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="auth-card-head">
            <div>
              <span className="eyebrow">Bảo mật</span>
              <h2>{mode === "login" ? "Đăng nhập" : "Đăng ký"}</h2>
            </div>
            <ShieldCheck size={24} />
          </div>

          <div className="auth-switch" role="tablist" aria-label="Chọn chế độ xác thực">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => switchMode("login")}>
              Đăng nhập
            </button>
            <button className={mode === "register" ? "active" : ""} type="button" onClick={() => switchMode("register")}>
              Đăng ký
            </button>
          </div>

          {authError && (
            <div className="api-alert" role="alert">
              {authError}
            </div>
          )}

          {resetSent && (
            <div className="auth-success" role="status">
              Link khôi phục đã được gửi nếu email tồn tại trong hệ thống.
            </div>
          )}

          {mode === "register" && (
            <label className="auth-field">
              <span>Họ tên</span>
              <div>
                <UserRound size={17} />
                <input value={displayName} onChange={(event) => setDisplayName(sanitizeAuthText(event.target.value, 80))} placeholder="Nguyễn Văn A" autoComplete="name" />
              </div>
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <div>
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(sanitizeAuthText(event.target.value, 254))}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          </label>

          <label className="auth-field">
            <span>Mật khẩu</span>
            <div>
              <LockKeyhole size={17} />
              <input
                type={passwordInputType}
                value={password}
                onChange={(event) => setPassword(event.target.value.slice(0, 128))}
                placeholder="Tối thiểu 8 ký tự"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button type="button" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setShowPassword((current) => !current)}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          <div className={`password-strength strength-${passwordStrength.score}`} style={{ "--strength": `${passwordStrength.score * 25}%` } as CSSProperties}>
            <span>{passwordStrength.label}</span>
            <i aria-hidden="true" />
          </div>

          {mode === "register" && (
            <>
              <div className="password-rules" aria-label="Yêu cầu mật khẩu">
                {["ít nhất 8 ký tự", "chữ thường", "chữ hoa", "số", "ký tự đặc biệt"].map((rule) => (
                  <span className={passwordStrength.missing.includes(rule) ? "" : "passed"} key={rule}>
                    {passwordStrength.missing.includes(rule) ? <X size={13} /> : <Check size={13} />}
                    {rule}
                  </span>
                ))}
              </div>

              <label className="auth-field">
                <span>Xác nhận mật khẩu</span>
                <div>
                  <LockKeyhole size={17} />
                  <input
                    type={confirmPasswordInputType}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value.slice(0, 128))}
                    placeholder="Nhập lại mật khẩu"
                    autoComplete="new-password"
                  />
                  <button type="button" aria-label={showConfirmPassword ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"} onClick={() => setShowConfirmPassword((current) => !current)}>
                    {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            </>
          )}

          <div className="auth-options">
            <label>
              <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
              <span>Ghi nhớ đăng nhập</span>
            </label>
            {mode === "login" && (
              <button type="button" onClick={handlePasswordReset}>
                Quên mật khẩu
              </button>
            )}
          </div>

          {captchaRequired && (
            <label className="auth-human-check">
              <input type="checkbox" checked={captchaChecked} onChange={(event) => setCaptchaChecked(event.target.checked)} />
              <span>Xác minh bảo vệ sau {failedAttempts} lần đăng nhập sai</span>
            </label>
          )}

          {isLocked && <p className="auth-lock-note">Tạm khóa đăng nhập trong {lockSecondsLeft} giây để chống dò mật khẩu.</p>}

          <button className="auth-submit" type="submit" disabled={isSubmitting || isLocked}>
            {isSubmitting ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>

          <div className="auth-divider">
            <span>hoặc</span>
          </div>

          <div className="social-grid">
            <button className="social-button" type="button" disabled={isSubmitting || isLocked} onClick={() => handleSocialLogin("google")}>
              <span aria-hidden="true">G</span>
              Google
            </button>
            <button className="social-button" type="button" disabled={isSubmitting || isLocked} onClick={() => handleSocialLogin("apple")}>
              <span aria-hidden="true">A</span>
              Apple
            </button>
          </div>

          <p className="auth-security-note">
            Backend xác thực Firebase token cho mọi API. Với session cookie HttpOnly + CSRF, bước tiếp theo sẽ đặt ở backend production.
          </p>
        </form>
      </section>

      {pendingMfaUser && (
        <div className="otp-overlay" role="dialog" aria-modal="true" aria-labelledby="otp-title">
          <section className="otp-card">
            <div className="otp-icon" aria-hidden="true">
              <KeyRound size={22} />
            </div>
            <h2 id="otp-title">Xác thực 2 bước</h2>
            <p>Nhập mã OTP 6 số. Màn hình này đã sẵn sàng để nối Firebase MFA hoặc OTP backend.</p>
            <input inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
            <button type="button" onClick={handleOtpConfirm}>
              Xác nhận
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
