import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import { Logo } from "../components/Logo.js";
import { useAuth } from "../auth.js";

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
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
      logout();
      navigate("/login?invitation=accepted", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation could not be accepted.");
    } finally { setBusy(false); }
  }

  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <Card className="w-full max-w-md p-7">
      <Logo />
      <h1 className="mt-6 text-2xl font-bold text-slate-950">Accept workspace invitation</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">If this email already has a SEnuke AI account, leave the new-account fields blank. Otherwise, enter your name and create a password for your own login.</p>
      {user && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">You are currently signed in as <b>{user.email}</b>. After accepting, this session will be signed out so the invited user can sign in with their own account.</div>}
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {!token ? <div className="mt-5 text-sm text-red-700">This invitation link is missing its secure token.</div> : <form onSubmit={(event) => void accept(event)} className="mt-5 space-y-4">
        <label className="block text-sm font-bold">Name <span className="font-normal text-slate-400">(new accounts)</span><input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 font-normal" /></label>
        <label className="block text-sm font-bold">Create password <span className="font-normal text-slate-400">(new accounts, minimum 8 characters)</span><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 font-normal" /></label>
        <button disabled={busy} className="h-11 w-full rounded-lg bg-brand-600 text-sm font-bold text-white disabled:bg-slate-300">{busy ? "Joining…" : "Accept invitation"}</button>
      </form>}
      <Link to="/login" className="mt-5 block text-center text-sm font-bold text-brand-700">Back to sign in</Link>
    </Card>
  </div>;
}
