import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

type Activation = {
  planCode: string | null;
  billingInterval: string | null;
  email: string;
  accountExists: boolean;
  expiresAt: string;
};

export default function JvZooActivation() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [activation, setActivation] = useState<Activation | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(token));
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!token) return;
    void api.post<{ activation: Activation }>("/api/integrations/jvzoo/activation/inspect", { token })
      .then((result) => setActivation(result.activation))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This activation link is invalid or expired."))
      .finally(() => setBusy(false));
  }, [token]);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.post<{ message: string }>("/api/integrations/jvzoo/activation/request", { email });
      setMessage(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The activation email could not be requested.");
    } finally { setBusy(false); }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api.post("/api/integrations/jvzoo/activation/complete", { token, name: name || undefined, password });
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The purchase could not be activated.");
    } finally { setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-5 py-12">
    <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white p-7 shadow-2xl sm:p-10">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">SEnuke AI · JVZoo</div>
      <h1 className="mt-3 text-3xl font-black text-slate-950">Activate your purchase</h1>
      {busy && !activation ? <p className="mt-5 text-sm text-slate-600">Checking your secure purchase link…</p> : null}
      {complete ? <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-900">
        <b>Your JVZoo purchase is active.</b><p className="mt-2">You can now sign in with the email used at checkout.</p>
        <Link className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white" to="/login">Sign in to SEnuke AI</Link>
      </div> : activation ? <>
        <div className="mt-6 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-slate-700">
          <b className="capitalize text-slate-950">{activation.planCode ?? "SEnuke AI"} · {activation.billingInterval ?? "subscription"}</b>
          <p className="mt-1">Purchase email: {activation.email}</p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={activate}>
          {!activation.accountExists && <label className="block text-sm font-bold text-slate-800">Your name<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" value={name} onChange={(event) => setName(event.target.value)} required /></label>}
          <label className="block text-sm font-bold text-slate-800">{activation.accountExists ? "Existing account password" : "Create a password"}<input type="password" minLength={8} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {activation.accountExists && <p className="text-xs leading-5 text-slate-500">This purchase matches an existing SEnuke AI account. Enter its password to attach the verified entitlement.</p>}
          <button disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-700 px-4 py-3 font-black text-white disabled:opacity-50">{busy ? "Activating…" : "Activate purchase"}</button>
        </form>
      </> : !token ? <form className="mt-6 space-y-4" onSubmit={requestLink}>
        <p className="text-sm leading-6 text-slate-600">Enter the email used for your JVZoo purchase. For privacy, the response is the same whether or not a matching purchase exists.</p>
        <label className="block text-sm font-bold text-slate-800">Purchase email<input type="email" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <button disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-700 px-4 py-3 font-black text-white disabled:opacity-50">{busy ? "Sending…" : "Send secure activation link"}</button>
      </form> : null}
      {message && <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
      {error && <p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
      <p className="mt-7 text-center text-xs text-slate-500">Already activated? <Link className="font-bold text-brand-700" to="/login">Sign in</Link></p>
    </section>
  </main>;
}
