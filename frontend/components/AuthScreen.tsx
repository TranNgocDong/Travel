"use client";

import { Check, Compass, Eye, EyeOff, Globe2, KeyRound, Languages, LockKeyhole, Mail, MapPin, Moon, ShieldCheck, Sun, UserRound, X } from "lucide-react";
import { FormEvent, type CSSProperties, useEffect, useMemo, useState } from "react";

import { login, loginWithApple, loginWithGoogle, registerWithEmail, requestPasswordReset, type ApiUser } from "@/lib/api";
import { analyzePassword, sanitizeAuthText, validateDisplayName, validateEmail, validateOtp, validatePassword } from "@/lib/authValidation";

type AuthMode = "login" | "register";

type AuthScreenProps = {
  theme: "light" | "dark";
  onAuthenticated: (user: ApiUser) => void;
  onThemeToggle: () => void;
};

function getLoginErrorMessage(error: unknown, mode: AuthMode): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : "";

  if (mode === "register") {
    if (code.includes("email-already-in-use")) {
      return "Email này đã có tài khoản. Hãy chuyển sang Đăng nhập.";
    }

    if (code.includes("weak-password")) {
      return "Mật khẩu chưa đủ mạnh. Cần ít nhất 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.";
    }

    return "Không đăng ký được. Kiểm tra lại thông tin hoặc thử email khác.";
  }

  if (code.includes("user-not-found") || code.includes("invalid-credential")) {
    return "Email hoặc mật khẩu chưa đúng. Nếu chưa có tài khoản, hãy bấm Đăng ký trước.";
  }

  if (code.includes("wrong-password")) {
    return "Mật khẩu chưa đúng. Hãy nhập lại hoặc dùng Quên mật khẩu.";
  }

  if (code.includes("too-many-requests")) {
    return "Bạn thử đăng nhập quá nhiều lần. Chờ một lát rồi thử lại.";
  }

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "Firebase đăng nhập được nhưng chưa kết nối được backend. Kiểm tra API server/Render.";
  }

  return "Đăng nhập thất bại. Kiểm tra lại email hoặc mật khẩu.";
}

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
    } catch (error) {
      registerFailedAttempt();
      setAuthError(getLoginErrorMessage(error, mode));
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
    <main className="auth-page waymate-auth">
      <section className="auth-hero" aria-label="TrailLedger travel security">
        <div className="auth-brand">
          <img className="brand-logo" src="/trailledger-logo.png" alt="TrailLedger" />
          <div>
            <p>TrailLedger</p>
            <span>Bạn đồng hành cho mọi cung đường</span>
          </div>
        </div>

        <div className="auth-visual-card" aria-hidden="true">
          <div className="visual-sky" />
          <div className="visual-mountain back" />
          <div className="visual-mountain front" />
          <div className="visual-road" />
          <div className="visual-compass">
            <Compass size={58} />
          </div>
          <span className="visual-pin one"><MapPin size={18} /></span>
          <span className="visual-pin two"><ShieldCheck size={18} /></span>
          <span className="visual-pin three"><Globe2 size={18} /></span>
        </div>

        <div className="auth-hero-copy">
          <span className="eyebrow">Travel group workspace</span>
          <h1>
            <span>Lập kế hoạch.</span>
            <span>Đi cùng nhau.</span>
            <span>Theo dõi an toàn.</span>
          </h1>
        </div>

      </section>

      <section className="auth-panel-zone" aria-label="Authentication form">
        <button className="icon-button auth-theme-button" type="button" title="Đổi giao diện" aria-label="Đổi giao diện" onClick={onThemeToggle}>
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <button className="icon-button auth-language-button" type="button" title="Ngôn ngữ" aria-label="Ngôn ngữ">
          <Languages size={19} />
        </button>

        <div className="auth-mobile-brand">
          <img className="brand-logo" src="/trailledger-logo.png" alt="TrailLedger" />
          <div>
            <p>TrailLedger</p>
            <span>Travel group workspace</span>
          </div>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="auth-card-head">
            <div className="auth-card-brand">
              <img src="/trailledger-logo.png" alt="TrailLedger" />
              <div>
                <h2>TrailLedger</h2>
                <p>{mode === "login" ? "Đăng nhập để tiếp tục chuyến đi." : "Tạo tài khoản cho chuyến đi của bạn."}</p>
              </div>
            </div>
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

      <nav className="auth-footer-links" aria-label="Liên kết bảo mật">
        <button type="button">Bảo mật</button>
        <button type="button">Điều khoản</button>
        <button type="button">Hỗ trợ</button>
      </nav>
    </main>
  );
}
