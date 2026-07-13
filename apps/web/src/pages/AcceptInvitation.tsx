import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import { Logo } from "../components/Logo.js";
import { useAuth } from "../auth.js";

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = params.get("token") ?? "";

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api.post("/api/auth/workspace-invitations/accept", { token, name: name || undefined, password: password || undefined });
      navigate(user ? "/agency?tab=teams" : "/login?invitation=accepted", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation could not be accepted.");
    } finally { setBusy(false); }
  }

  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <Card className="w-full max-w-md p-7">
      <Logo />
      <h1 className="mt-6 text-2xl font-bold text-slate-950">Accept workspace invitation</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">If you already have a SEnuke AI account, leave the new-account fields blank. Otherwise, choose your name and password.</p>
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {!token ? <div className="mt-5 text-sm text-red-700">This invitation link is missing its secure token.</div> : <form onSubmit={(event) => void accept(event)} className="mt-5 space-y-4">
        <label className="block text-sm font-bold">Name <span className="font-normal text-slate-400">(new accounts)</span><input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 font-normal" /></label>
        <label className="block text-sm font-bold">Password <span className="font-normal text-slate-400">(new accounts)</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 font-normal" /></label>
        <button disabled={busy} className="h-11 w-full rounded-lg bg-brand-600 text-sm font-bold text-white disabled:bg-slate-300">{busy ? "Joining…" : "Accept invitation"}</button>
      </form>}
      <Link to="/login" className="mt-5 block text-center text-sm font-bold text-brand-700">Back to sign in</Link>
    </Card>
  </div>;
}
