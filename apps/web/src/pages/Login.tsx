// Auth screens aligned to the SEnuke AI - AI Growth Operating System mockups.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.js";
import { fetchPublicConfig, forgotPassword, resendVerification } from "../api.js";
import { Button, Input } from "../components/ui.js";
import { Logo } from "../components/Logo.js";

type Mode = "signin" | "signup" | "forgot" | "verify" | "reset";

// Keep the existing self-registration screen available in source, but do not
// expose it while account provisioning is controlled by JVZoo and Admin.
const PUBLIC_SELF_REGISTRATION_ENABLED = false;

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
  const [jvZooPurchase, setJvZooPurchase] = useState(false);
  const [jvZooPlan, setJvZooPlan] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token") ?? "";
    const fromJvZoo = url.searchParams.get("source")?.toLowerCase() === "jvzoo";
    const purchasedPlan = url.searchParams.get("plan")?.toLowerCase() ?? "";
    setJvZooPurchase(fromJvZoo);
    setJvZooPlan(["starter", "business", "agency"].includes(purchasedPlan) ? purchasedPlan : "");
    if (url.pathname === "/verify-email" && token) {
      setRouteToken(token);
      setMode("verify");
    } else if (url.pathname === "/reset-password" && token) {
      setRouteToken(token);
      setMode("reset");
    } else if (fromJvZoo && PUBLIC_SELF_REGISTRATION_ENABLED) {
      setMode("signup");
    }
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-800 lg:h-screen lg:overflow-hidden">
      <div className="grid min-h-screen lg:h-screen lg:min-h-0 lg:grid-cols-[0.56fr_1fr]">
        <section className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-slate-50 px-7 py-8 sm:px-10 lg:px-12 lg:py-7">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-[radial-gradient(ellipse_at_bottom_left,rgba(37,99,235,0.14),transparent_60%)]" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full border border-brand-100" />
          <div className="pointer-events-none absolute -bottom-16 -left-10 h-72 w-72 rounded-full border border-brand-100" />

          <div className="relative flex items-center gap-3">
            <Logo size={44} />
          </div>

          <div className="relative mt-10 max-w-lg lg:mt-12">
            <h1 className="text-4xl font-bold leading-tight text-slate-950 xl:text-[42px]">{mode === "signup" ? "AI-Powered SEO. Smarter. Faster. Better." : "Welcome back"}</h1>
            <p className="mt-4 max-w-md text-base leading-7 text-slate-500 xl:text-lg">
              {mode === "signup" ? "Create your account and unlock the full power of SEnuke AI - AI Growth Operating System to grow your organic presence." : "Sign in to your account to continue managing your projects and AI campaigns."}
            </p>

            <div className="mt-8 space-y-5 xl:mt-10 xl:space-y-6">
              {mode === "signup" ? (
                <>
                  <AuthBenefit tone="blue" icon="▥" title="AI-Driven Insights">Leverage AI to discover high-impact opportunities and content gaps.</AuthBenefit>
                  <AuthBenefit tone="green" icon="⌁" title="Guide & Scale">Find safe authority opportunities, optimize content, and govern SEO workflows with approvals.</AuthBenefit>
                  <AuthBenefit tone="violet" icon="◈" title="Track What Matters">Monitor rankings, traffic, and conversions in one powerful dashboard.</AuthBenefit>
                  <AuthBenefit tone="orange" icon="♙" title="Built for Teams">Collaborate with your team and manage projects across workspaces.</AuthBenefit>
                </>
              ) : (
                <>
                  <AuthBenefit tone="blue" icon="▥" title="Smarter AI Marketing">Optimize content, keywords, and backlinks with AI-powered insights.</AuthBenefit>
                  <AuthBenefit tone="green" icon="◈" title="Secure & Reliable">Your data is encrypted and protected with enterprise-grade security.</AuthBenefit>
                  <AuthBenefit tone="violet" icon="♙" title="Built for Agencies">Manage multiple projects, clients, and campaigns with ease.</AuthBenefit>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-5 sm:px-10 lg:py-4">
          <div className="w-full max-w-[620px]">
            {mode === "verify" ? (
              <AuthCard>
                <VerifyEmailForm token={routeToken} onVerify={verifyEmail} onBack={() => setMode("signin")} />
              </AuthCard>
            ) : mode === "reset" ? (
              <AuthCard>
                <ResetPasswordForm token={routeToken} onReset={resetPassword} onBack={() => setMode("signin")} />
              </AuthCard>
            ) : mode === "forgot" ? (
              <AuthCard>
                <ForgotForm onBack={() => setMode("signin")} />
              </AuthCard>
            ) : mode === "signup" && PUBLIC_SELF_REGISTRATION_ENABLED ? (
              <AuthCard>
                <SignUpForm onRegister={register} onSignIn={() => setMode("signin")} jvZooPurchase={jvZooPurchase} jvZooPlan={jvZooPlan} />
              </AuthCard>
            ) : (
              <AuthCard>
                <SignInForm onLogin={login} onForgot={() => setMode("forgot")} onSignup={() => setMode("signup")} allowSignup={PUBLIC_SELF_REGISTRATION_ENABLED} />
              </AuthCard>
            )}

            <div className="mt-4 text-center text-xs text-slate-500 xl:mt-5 xl:text-sm">
              <span className="font-medium">Secure login</span>
              <span className="mx-2">•</span>
              <span>Your data is protected with 256-bit encryption</span>
            </div>
            <div className="mt-4 text-center text-xs text-slate-500 xl:mt-5 xl:text-sm">
              Need help? <a href="mailto:support@senuke.com" className="font-semibold text-brand-600 hover:underline">Contact Support ↗</a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function AuthBenefit({ tone, icon, title, children }: { tone: "blue" | "green" | "violet" | "orange"; icon: string; title: string; children: React.ReactNode }) {
  const styles = {
    blue: "bg-brand-50 text-brand-700 border-brand-100",
    green: "bg-green-50 text-green-700 border-green-100",
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
  }[tone];
  return (
    <div className="flex items-start gap-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-lg font-bold ${styles}`}>{icon}</div>
      <div>
        <div className="text-base font-bold text-slate-950 xl:text-lg">{title}</div>
        <p className="mt-0.5 max-w-sm text-sm leading-6 text-slate-500 xl:text-base">{children}</p>
      </div>
    </div>
  );
}

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-[0_18px_55px_rgba(15,23,42,0.08)] sm:px-8 xl:px-10 xl:py-7">
      {children}
    </div>
  );
}

function AuthInput({
  label,
  icon,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  passwordVisible,
  onTogglePassword,
}: {
  label: string;
  icon: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  passwordVisible?: boolean;
  onTogglePassword?: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-slate-900">{label}</span>
      <span className="relative block">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
          <AuthIcon name={icon} />
        </span>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`h-11 w-full rounded-lg border border-slate-200 bg-white pl-11 ${onTogglePassword ? "pr-12" : "pr-4"} text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 xl:h-12 xl:text-base`}
        />
        {onTogglePassword && (
          <button type="button" onClick={onTogglePassword} aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {passwordVisible ? <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 5a16 16 0 0 1-2.1 2.8" /><path d="M6.6 6.6C4.3 8 3 10 3 10s3.5 5 9 5c1 0 2-.2 2.9-.5" /></> : <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
            </svg>
          </button>
        )}
      </span>
    </label>
  );
}

function AuthIcon({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      {(name === "email" || name === "✉") && (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="2" />
          <path {...common} d="m3 7 9 6 9-6" />
        </>
      )}
      {(name === "password" || name === "▣") && (
        <>
          <rect {...common} x="5" y="11" width="14" height="9" rx="2" />
          <path {...common} d="M8 11V8a4 4 0 0 1 8 0v3" />
          <path {...common} d="M12 15v2" />
        </>
      )}
      {(name === "user" || name === "♙") && (
        <>
          <circle {...common} cx="12" cy="8" r="4" />
          <path {...common} d="M4 21a8 8 0 0 1 16 0" />
        </>
      )}
      {(name === "workspace" || name === "▦") && (
        <>
          <path {...common} d="M4 20V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14" />
          <path {...common} d="M16 8h2a2 2 0 0 1 2 2v10" />
          <path {...common} d="M8 8h4" />
          <path {...common} d="M8 12h4" />
          <path {...common} d="M8 16h4" />
        </>
      )}
      {name === "chevron" && <path {...common} d="m6 9 6 6 6-6" />}
    </svg>
  );
}

function MockupSelectButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`font-semibold ${active ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>
      {children}
    </button>
  );
}

/*
  Legacy tab button is kept for reset/signup sections that do not use the
  screenshot's single-card sign-in layout.
*/
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
    <div className="mt-1 rounded-lg border border-charcoal-100 bg-charcoal-50 px-2.5 py-1">
      <div className="grid gap-x-2 gap-y-0 text-[10px] leading-4 sm:grid-cols-2">
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
  onSignup,
  allowSignup,
}: {
  onLogin: (e: string, p: string) => Promise<void>;
  onForgot: () => void;
  onSignup: () => void;
  allowSignup: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
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
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-950 xl:text-3xl">Sign in to SEnuke AI - AI Growth Operating System</h2>
        <p className="mt-2 text-base text-slate-500">Enter your credentials to access your account.</p>
      </div>
      <div className="mt-6 space-y-4">
        <div>
          <AuthInput label="Email address" icon="email" type="email" value={email} onChange={setEmail} autoComplete="username" placeholder="you@company.com" />
          <FieldError msg={err.email} />
        </div>
        <div>
          <AuthInput label="Password" icon="password" type={passwordVisible ? "text" : "password"} value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" passwordVisible={passwordVisible} onTogglePassword={() => setPasswordVisible((visible) => !visible)} />
          <FieldError msg={err.password} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <label className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
          Remember me
        </label>
        <button type="button" onClick={onForgot} className="text-sm font-semibold text-brand-600 hover:underline">
          Forgot password?
        </button>
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
      <Button type="submit" disabled={busy} className="mt-5 h-11 w-full text-base xl:h-12">
        {busy ? "Signing in…" : "Sign In"}
      </Button>
      {allowSignup ? <>
        <div className="my-5 flex items-center gap-5 text-sm text-slate-400"><div className="h-px flex-1 bg-slate-200" /><span className="font-semibold">or</span><div className="h-px flex-1 bg-slate-200" /></div>
        <div className="text-center text-sm text-slate-500">Don’t have an account? <button type="button" onClick={onSignup} className="font-semibold text-brand-600 hover:underline">Create an account</button></div>
      </> : <div className="mt-5 rounded-lg border border-brand-100 bg-brand-50 p-3 text-center text-sm leading-6 text-brand-900">
        New customer accounts are created after verified JVZoo checkout. Use the secure activation email sent to your purchase email address.
      </div>}
    </form>
  );
}

function SignUpForm({
  onRegister,
  onSignIn,
  jvZooPurchase,
  jvZooPlan,
}: {
  onRegister: (i: { name: string; workspaceType: string; email: string; password: string; captchaToken?: string }) => Promise<string>;
  onSignIn: () => void;
  jvZooPurchase: boolean;
  jvZooPlan: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState("");
  const [trialPolicy, setTrialPolicy] = useState({ enabled: false, days: 14 });
  const displayedPlan = jvZooPlan === "agency" ? "Agency" : jvZooPlan === "business" ? "Business" : "Entrepreneur";
  const canSubmit = Boolean(name && emailOk(email) && passwordValid(password) && confirm === password && acceptedTerms);

  useEffect(() => {
    let cancelled = false;
    fetchPublicConfig()
      .then((config) => {
        if (!cancelled) {
          setCaptchaSiteKey(config.recaptchaSiteKey || "");
          setTrialPolicy({ enabled: config.trialEnabled, days: config.trialDays });
        }
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
    if (!emailOk(email)) next.email = "Enter a valid email";
    if (!passwordValid(password)) next.password = "Complete all password requirements";
    if (confirm !== password) next.confirm = "Passwords do not match";
    if (!acceptedTerms) next.terms = "Accept the terms to continue";
    setErr(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const captchaToken = captchaSiteKey ? await executeRecaptcha(captchaSiteKey, "register") : undefined;
      setSuccess(await onRegister({ name, workspaceType: "Personal", email, password, captchaToken }));
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
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-950 xl:text-3xl">Create Your Account</h2>
        <p className="mt-1.5 text-base text-slate-500">{jvZooPurchase ? "Claim your JVZoo purchase and create your SEnuke AI - AI Growth Operating System account." : "Get started in less than a minute."}</p>
      </div>
      {jvZooPurchase && <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm leading-5 text-brand-900"><strong>Already purchased through JVZoo?</strong> Use the same delivery email used at checkout. After email verification, your verified purchase will be connected automatically and you will not be charged again.</div>}
      <div className="mt-4 space-y-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div><AuthInput label="Full Name" icon="user" value={name} onChange={setName} autoComplete="name" placeholder="Full name" /><FieldError msg={err.name} /></div>
          <div><AuthInput label="Email Address" icon="email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="Email address" /><FieldError msg={err.email} /></div>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <AuthInput label="Password" icon="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Password" />
            <FieldError msg={err.password} />
          </div>
          <div><AuthInput label="Confirm Password" icon="password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Confirm password" /><FieldError msg={err.confirm} /></div>
        </div>
        <PasswordChecklist password={password} confirm={confirm} />
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">{displayedPlan} workspace</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">{jvZooPurchase ? "Your verified JVZoo purchase determines the workspace and plan after email verification." : "New trials start on Entrepreneur for one Owner/Admin. Business and Agency workspaces are activated by their corresponding plan."}</p>
        </div>
        <label className="flex items-start gap-2.5 text-xs leading-5 text-slate-500 xl:text-sm">
          <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
          <span>I agree to the <Link to="/terms" className="font-semibold text-brand-600 hover:underline">Terms of Service</Link> and <Link to="/privacy" className="font-semibold text-brand-600 hover:underline">Privacy Policy</Link>.</span>
        </label>
        <FieldError msg={err.terms} />
      </div>
      {err.form && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err.form}</div>}
      <Button type="submit" disabled={busy || !canSubmit} className="mt-4 h-11 w-full text-base xl:h-12">
        {busy ? "Creating…" : "♙  Create Account"}
      </Button>
      <div className="mt-4 text-center text-sm text-slate-500">
        Already have an account? <button type="button" onClick={onSignIn} className="font-semibold text-brand-600 hover:underline">Sign in</button>
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">↗</div>
          <div>
            <div className="text-sm font-bold text-slate-950">{jvZooPurchase ? "Connect your existing JVZoo purchase" : trialPolicy.enabled ? `Start your ${trialPolicy.days}-day trial` : "Activate your workspace after verification"}</div>
            <p className="text-xs leading-4 text-slate-500">{jvZooPurchase ? "Verification securely proves ownership of the delivery email before SEnuke AI - AI Growth Operating System unlocks the purchased plan." : trialPolicy.enabled ? "Verify your email, then create your first project with trial access." : "Verify your email, choose the plan for your workspace, and complete secure checkout through JVZoo before using projects or AI tools."}</p>
          </div>
        </div>
      </div>
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
