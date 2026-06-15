// Half-and-half auth screen. Left: brand + blurb. Right: tabbed Sign in / Create
// account + Forgot password, with email + password validation.
import { useState } from "react";
import { useAuth } from "../auth.js";
import { forgotPassword } from "../api.js";
import { Button, Input } from "../components/ui.js";
import { LogoMark } from "../components/Logo.js";

type Mode = "signin" | "signup" | "forgot";

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");

  return (
    <div className="flex min-h-screen">
      {/* Left: brand */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-charcoal-800 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <LogoMark size={40} />
          <span className="text-xl font-bold tracking-tight">
            Web<span className="text-brand-400">tummy</span>
          </span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            SEO &amp; AI Search audits, <span className="text-brand-400">on autopilot</span>.
          </h1>
          <p className="mt-4 text-charcoal-200">
            Crawl client sites, surface technical &amp; content issues, score AI-search
            readiness, and ship client-ready reports — all in one place.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            {[
              ["100+", "client sites"],
              ["30+", "audit checks"],
              ["AI", "search ready"],
            ].map(([a, b]) => (
              <div key={b} className="rounded-xl bg-white/5 p-4">
                <div className="text-2xl font-bold text-brand-400">{a}</div>
                <div className="text-xs text-charcoal-200">{b}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-charcoal-300">Created by Dot H Digital · © {new Date().getFullYear()}</div>
      </div>

      {/* Right: forms */}
      <div className="flex w-full items-center justify-center px-6 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <LogoMark size={34} />
            <span className="text-lg font-bold text-charcoal-800">
              Web<span className="text-brand-500">tummy</span>
            </span>
          </div>

          {mode === "forgot" ? (
            <ForgotForm onBack={() => setMode("signin")} />
          ) : (
            <>
              {/* Tabs */}
              <div className="mb-6 flex rounded-lg bg-charcoal-100 p-1">
                <TabBtn active={mode === "signin"} onClick={() => setMode("signin")}>Sign in</TabBtn>
                <TabBtn active={mode === "signup"} onClick={() => setMode("signup")}>Create account</TabBtn>
              </div>
              {mode === "signin" ? (
                <SignInForm onLogin={login} onForgot={() => setMode("forgot")} />
              ) : (
                <SignUpForm onRegister={register} />
              )}
            </>
          )}
        </div>
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

function SignInForm({
  onLogin,
  onForgot,
}: {
  onLogin: (e: string, p: string) => Promise<void>;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState("admin@webtummy.com");
  const [password, setPassword] = useState("ChangeMe!2026");
  const [err, setErr] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

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
    } catch {
      setErr({ form: "Invalid email or password" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-bold text-charcoal-800">Welcome back</h2>
      <p className="mt-1 text-sm text-charcoal-400">Sign in to your dashboard.</p>
      <div className="mt-6 space-y-4">
        <div>
          <Input label="Email" type="email" value={email} onChange={setEmail} />
          <FieldError msg={err.email} />
        </div>
        <div>
          <Input label="Password" type="password" value={password} onChange={setPassword} />
          <FieldError msg={err.password} />
          <div className="mt-1 text-right">
            <button type="button" onClick={onForgot} className="text-xs font-medium text-brand-600 hover:underline">
              Forgot password?
            </button>
          </div>
        </div>
      </div>
      {err.form && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err.form}</div>}
      <Button type="submit" disabled={busy} className="mt-6 w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function SignUpForm({
  onRegister,
}: {
  onRegister: (i: { name: string; companyName: string; email: string; password: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [companyName, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name) next.name = "Your name is required";
    if (!companyName) next.companyName = "Company name is required";
    if (!emailOk(email)) next.email = "Enter a valid email";
    if (password.length < 8) next.password = "At least 8 characters";
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) next.password = "Include a letter and a number";
    if (confirm !== password) next.confirm = "Passwords do not match";
    setErr(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await onRegister({ name, companyName, email, password });
    } catch (e) {
      setErr({ form: String(e).replace(/^Error:\s*/, "") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-bold text-charcoal-800">Create your account</h2>
      <p className="mt-1 text-sm text-charcoal-400">Start auditing in minutes.</p>
      <div className="mt-6 space-y-3">
        <div><Input label="Your name" value={name} onChange={setName} /><FieldError msg={err.name} /></div>
        <div><Input label="Company name" value={companyName} onChange={setCompany} /><FieldError msg={err.companyName} /></div>
        <div><Input label="Email" type="email" value={email} onChange={setEmail} /><FieldError msg={err.email} /></div>
        <div><Input label="Password" type="password" value={password} onChange={setPassword} /><FieldError msg={err.password} /></div>
        <div><Input label="Confirm password" type="password" value={confirm} onChange={setConfirm} /><FieldError msg={err.confirm} /></div>
      </div>
      {err.form && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err.form}</div>}
      <Button type="submit" disabled={busy} className="mt-6 w-full">
        {busy ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
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
