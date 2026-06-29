// Half-and-half auth screen. Left: brand + blurb. Right: tabbed Sign in / Create
// account + Forgot password, with email + password validation.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.js";
import { fetchPublicConfig, forgotPassword, resendVerification } from "../api.js";
import { Button, Input } from "../components/ui.js";
import { LogoMark } from "../components/Logo.js";

type Mode = "signin" | "signup" | "forgot" | "verify" | "reset";

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const passwordRules = (password: string) => ({
  minLength: password.length >= 8,
  letter: /[A-Za-z]/.test(password),
  number: /[0-9]/.test(password),
  special: /[^A-Za-z0-9]/.test(password),
});
const passwordValid = (password: string) => Object.values(passwordRules(password)).every(Boolean);

export default function Login() {
  const { login, register, verifyEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [routeToken, setRouteToken] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token") ?? "";
    if (url.pathname === "/verify-email" && token) {
      setRouteToken(token);
      setMode("verify");
    } else if (url.pathname === "/reset-password" && token) {
      setRouteToken(token);
      setMode("reset");
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="flex flex-col justify-between bg-charcoal-900 px-6 py-8 text-white sm:px-10 lg:px-12">
          <div className="flex items-center gap-3">
            <LogoMark size={42} />
            <span className="text-xl font-bold tracking-tight text-white">
              Web<span className="text-brand-400">tummy</span>
            </span>
          </div>

          <div className="py-12 lg:py-0">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex rounded-full border border-brand-400/30 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-200">
                SEO audit command center
              </div>
              <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
                SEO &amp; AI Search audits, on autopilot.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-charcoal-200">
                Crawl client sites, surface technical &amp; content issues, score AI-search readiness, and ship client-ready reports - all in one place.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ["100+", "client sites"],
                  ["30+", "audit checks"],
                  ["AI", "search ready"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="text-3xl font-bold text-brand-300">{value}</div>
                    <div className="mt-1 text-sm font-medium text-charcoal-200">{label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-3 text-sm text-charcoal-100 sm:grid-cols-3">
                <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3">Technical crawl issues</div>
                <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-4 py-3">Content gap scoring</div>
                <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-3">AI search readiness</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-charcoal-300">
            <span>Created by Dot H Digital · © {new Date().getFullYear()}</span>
            <Link to="/terms" className="text-charcoal-200 hover:text-white">Terms</Link>
            <Link to="/privacy" className="text-charcoal-200 hover:text-white">Privacy</Link>
          </div>
        </section>

        <section className="flex items-center justify-center border-t border-slate-200 bg-white px-6 py-10 shadow-[0_-16px_40px_rgba(15,23,42,0.04)] sm:px-10 lg:border-l lg:border-t-0 lg:shadow-[-16px_0_40px_rgba(15,23,42,0.04)]">
          <div className="w-full max-w-md">
            <div className="mb-6 text-right text-xs text-charcoal-400 lg:hidden">
              <Link to="/terms" className="font-medium text-brand-700 hover:underline">Terms</Link>
              <span className="mx-2">·</span>
              <Link to="/privacy" className="font-medium text-brand-700 hover:underline">Privacy</Link>
            </div>
            {mode === "verify" ? (
              <VerifyEmailForm token={routeToken} onVerify={verifyEmail} onBack={() => setMode("signin")} />
            ) : mode === "reset" ? (
              <ResetPasswordForm token={routeToken} onReset={resetPassword} onBack={() => setMode("signin")} />
            ) : mode === "forgot" ? (
              <ForgotForm onBack={() => setMode("signin")} />
            ) : (
              <>
                <div className="mb-6 flex rounded-lg bg-charcoal-100 p-1">
                  <TabBtn active={mode === "signin"} onClick={() => setMode("signin")}>Sign in</TabBtn>
                  <TabBtn active={mode === "signup"} onClick={() => setMode("signup")}>Create account</TabBtn>
                </div>
                {mode === "signin" ? (
                  <SignInForm onLogin={login} onForgot={() => setMode("forgot")} />
                ) : (
                  <SignUpForm onRegister={register} onSignIn={() => setMode("signin")} />
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
        active ? "bg-white text-charcoal-800 shadow-sm" : "text-charcoal-500"
      }`}
    >
      {children}
    </button>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-600">{msg}</p>;
}

function PasswordChecklist({ password, confirm }: { password: string; confirm?: string }) {
  const rules = passwordRules(password);
  const items = [
    ["Minimum 8 characters", rules.minLength],
    ["At least one text character", rules.letter],
    ["At least one number", rules.number],
    ["At least one special character", rules.special],
  ] as const;
  const showMatch = confirm !== undefined && (password.length > 0 || confirm.length > 0);

  return (
    <div className="mt-2 rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2">
      <div className="grid gap-1 text-xs sm:grid-cols-2">
        {items.map(([label, ok]) => (
          <div key={label} className={ok ? "font-medium text-green-700" : "text-charcoal-400"}>
            {ok ? "[x]" : "[ ]"} {label}
          </div>
        ))}
        {showMatch && (
          <div className={password && confirm === password ? "font-medium text-green-700" : "text-red-600"}>
            {password && confirm === password ? "[x]" : "[ ]"} Passwords match
          </div>
        )}
      </div>
    </div>
  );
}

function SignInForm({
  onLogin,
  onForgot,
}: {
  onLogin: (e: string, p: string) => Promise<void>;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<{ email?: string; password?: string; form?: string }>({});
  const [verificationMessage, setVerificationMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof err = {};
    if (!emailOk(email)) next.email = "Enter a valid email";
    if (!password) next.password = "Password is required";
    setErr(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await onLogin(email, password);
    } catch (e) {
      if (String(e).includes("email_not_verified")) {
        setErr({ form: "Please verify your email before signing in." });
      } else {
        setErr({ form: "Invalid email or password" });
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!emailOk(email)) {
      setErr({ email: "Enter a valid email" });
      return;
    }
    setResending(true);
    setVerificationMessage("");
    try {
      setVerificationMessage(await resendVerification(email));
    } catch {
      setVerificationMessage("If the account needs verification, a new verification link has been sent.");
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-bold text-charcoal-800">Welcome back</h2>
      <p className="mt-1 text-sm text-charcoal-400">Sign in to your dashboard.</p>
      <div className="mt-6 space-y-4">
        <div>
          <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
          <FieldError msg={err.email} />
        </div>
        <div>
          <Input label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          <FieldError msg={err.password} />
          <div className="mt-1 text-right">
            <button type="button" onClick={onForgot} className="text-xs font-medium text-brand-600 hover:underline">
              Forgot password?
            </button>
          </div>
        </div>
      </div>
      {err.form && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {err.form}
          {err.form.includes("verify") && (
            <button type="button" onClick={resend} disabled={resending} className="mt-2 block font-medium text-red-800 underline">
              {resending ? "Sending..." : "Resend verification email"}
            </button>
          )}
        </div>
      )}
      {verificationMessage && <div className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{verificationMessage}</div>}
      <Button type="submit" disabled={busy} className="mt-6 w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function SignUpForm({
  onRegister,
  onSignIn,
}: {
  onRegister: (i: { name: string; companyName: string; email: string; password: string; captchaToken?: string }) => Promise<string>;
  onSignIn: () => void;
}) {
  const [name, setName] = useState("");
  const [companyName, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState("");
  const canSubmit = Boolean(name && companyName && emailOk(email) && passwordValid(password) && confirm === password);

  useEffect(() => {
    let cancelled = false;
    fetchPublicConfig()
      .then((config) => {
        if (!cancelled) setCaptchaSiteKey(config.recaptchaSiteKey || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name) next.name = "Your name is required";
    if (!companyName) next.companyName = "Company name is required";
    if (!emailOk(email)) next.email = "Enter a valid email";
    if (!passwordValid(password)) next.password = "Complete all password requirements";
    if (confirm !== password) next.confirm = "Passwords do not match";
    setErr(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const captchaToken = captchaSiteKey ? await executeRecaptcha(captchaSiteKey, "register") : undefined;
      setSuccess(await onRegister({ name, companyName, email, password, captchaToken }));
      setPassword("");
      setConfirm("");
    } catch (e) {
      setErr({ form: String(e).replace(/^Error:\s*/, "") });
    } finally {
      setBusy(false);
    }
  };

  if (success) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-charcoal-800">Check your email</h2>
        <div className="mt-6 rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-700">{success}</div>
        <Button type="button" onClick={onSignIn} className="mt-6 w-full">
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-bold text-charcoal-800">Create your account</h2>
      <p className="mt-1 text-sm text-charcoal-400">Create your account, then verify your email to sign in.</p>
      <div className="mt-6 space-y-3">
        <div><Input label="Your name" value={name} onChange={setName} autoComplete="name" /><FieldError msg={err.name} /></div>
        <div><Input label="Company name" value={companyName} onChange={setCompany} autoComplete="organization" /><FieldError msg={err.companyName} /></div>
        <div><Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" /><FieldError msg={err.email} /></div>
        <div>
          <Input label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordChecklist password={password} confirm={confirm} />
          <FieldError msg={err.password} />
        </div>
        <div><Input label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" /><FieldError msg={err.confirm} /></div>
      </div>
      {err.form && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err.form}</div>}
      {canSubmit && (
        <Button type="submit" disabled={busy} className="mt-6 w-full">
          {busy ? "Creating…" : "Create account"}
        </Button>
      )}
    </form>
  );
}

function executeRecaptcha(siteKey: string, action: string): Promise<string> {
  const grecaptchaWindow = window as unknown as {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (key: string, options: { action: string }) => Promise<string>;
    };
  };

  function loadScript() {
    if (document.querySelector('script[src^="https://www.google.com/recaptcha/api.js"]')) return;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  loadScript();

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const grecaptcha = grecaptchaWindow.grecaptcha;
      if (grecaptcha) {
        window.clearInterval(timer);
        grecaptcha.ready(() => {
          grecaptcha.execute(siteKey, { action }).then(resolve).catch(reject);
        });
      } else if (Date.now() - started > 10000) {
        window.clearInterval(timer);
        reject(new Error("Captcha could not load"));
      }
    }, 100);
  });
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk(email)) {
      setErr("Enter a valid email");
      return;
    }
    setErr(undefined);
    setBusy(true);
    try {
      setSent(await forgotPassword(email));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-bold text-charcoal-800">Reset password</h2>
      <p className="mt-1 text-sm text-charcoal-400">We'll email you a reset link.</p>
      {sent ? (
        <div className="mt-6 rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-700">{sent}</div>
      ) : (
        <div className="mt-6">
          <Input label="Email" type="email" value={email} onChange={setEmail} />
          <FieldError msg={err} />
          <Button type="submit" disabled={busy} className="mt-6 w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </div>
      )}
      <button type="button" onClick={onBack} className="mt-4 w-full text-center text-sm text-brand-600 hover:underline">
        ← Back to sign in
      </button>
    </form>
  );
}

function VerifyEmailForm({
  token,
  onVerify,
  onBack,
}: {
  token: string;
  onVerify: (token: string) => Promise<void>;
  onBack: () => void;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      if (!token) {
        setErr("Verification token is missing.");
        setBusy(false);
        return;
      }
      try {
        await onVerify(token);
        window.history.replaceState(null, "", "/");
        onBack();
      } catch (e) {
        if (!cancelled) setErr(String(e).replace(/^Error:\s*/, ""));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void verify();
    return () => {
      cancelled = true;
    };
  }, [token, onVerify]);

  return (
    <div>
      <h2 className="text-2xl font-bold text-charcoal-800">Verify email</h2>
      <p className="mt-1 text-sm text-charcoal-400">
        {busy ? "Checking your verification link..." : err ? "This verification link could not be used." : "Email verified. You can now sign in."}
      </p>
      {err && <div className="mt-6 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">{err}</div>}
      {err && (
        <button type="button" onClick={onBack} className="mt-4 w-full text-center text-sm text-brand-600 hover:underline">
          Back to sign in
        </button>
      )}
    </div>
  );
}

function ResetPasswordForm({
  token,
  onReset,
  onBack,
}: {
  token: string;
  onReset: (token: string, password: string) => Promise<void>;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const canSubmit = Boolean(token && passwordValid(password) && confirm === password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!token) next.form = "Reset token is missing.";
    if (!passwordValid(password)) next.password = "Complete all password requirements";
    if (confirm !== password) next.confirm = "Passwords do not match";
    setErr(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await onReset(token, password);
      setPassword("");
      setConfirm("");
      window.history.replaceState(null, "", "/");
      onBack();
    } catch (e) {
      setErr({ form: String(e).replace(/^Error:\s*/, "") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-bold text-charcoal-800">Set new password</h2>
      <p className="mt-1 text-sm text-charcoal-400">Choose a new password for your account.</p>
      <div className="mt-6 space-y-4">
        <div>
          <Input label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordChecklist password={password} confirm={confirm} />
          <FieldError msg={err.password} />
        </div>
        <div>
          <Input label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <FieldError msg={err.confirm} />
        </div>
      </div>
      {err.form && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err.form}</div>}
      {canSubmit && (
        <Button type="submit" disabled={busy} className="mt-6 w-full">
          {busy ? "Saving..." : "Reset password"}
        </Button>
      )}
      <button type="button" onClick={onBack} className="mt-4 w-full text-center text-sm text-brand-600 hover:underline">
        Back to sign in
      </button>
    </form>
  );
}
