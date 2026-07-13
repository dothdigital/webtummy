import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, completeWelcome } from "../api.js";
import { Logo } from "../components/Logo.js";

type WorkspaceWelcome = {
  workspace: { name: string; workspaceType: string };
  summary: { clients: number };
};

export default function Welcome() {
  const navigate = useNavigate();
  const [data, setData] = useState<WorkspaceWelcome | null>(null);

  useEffect(() => {
    void api.get<WorkspaceWelcome>("/api/workspace").then(setData).catch(() => undefined);
  }, []);

  const workspaceName = data?.workspace.name ?? "Your Workspace";
  const agency = data?.workspace.workspaceType === "agency";

  function finish(destination: string) {
    completeWelcome();
    navigate(destination, { replace: true });
  }

  const actions = [
    { title: agency ? "Add your first client" : "Set up your workspace", description: agency ? "Set up client details, websites, and target markets." : "Add your business details and shared defaults.", label: agency ? "Add client" : "Open workspace", destination: agency ? "/workspace?tab=clients" : "/workspace", tone: "teal", icon: "▤" },
    { title: "Invite your team", description: "Bring in teammates and assign the right workspace roles.", label: "Invite team", destination: "/workspace?tab=teams", tone: "blue", icon: "♙" },
    { title: "Start a project", description: "Kick off intake, strategy, research, and execution.", label: "New project", destination: "/projects/new", tone: "amber", icon: "□" },
  ];

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#061314] px-5 py-8 text-white sm:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(78,201,178,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(78,201,178,0.16)_1px,transparent_1px)] [background-size:54px_54px]" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-teal-500/10 blur-3xl" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center justify-center">
        <div className="rounded-xl border border-white/5 bg-slate-950/70 px-5 py-3 shadow-2xl"><Logo size={32} /></div>
        <div className="mt-14 rounded-full border border-teal-400/20 bg-teal-400/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-teal-200"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-400" />Workspace ready</div>
        <h1 className="mt-6 text-center text-4xl font-bold tracking-tight sm:text-5xl">Welcome to {workspaceName}</h1>
        <p className="mt-5 max-w-2xl text-center text-base leading-7 text-slate-400">Your workspace is set up. Choose where you want to begin, or go directly to your dashboard.</p>

        <div className="mt-12 grid w-full gap-4 md:grid-cols-3">
          {actions.map((action) => {
            const iconTone = action.tone === "teal" ? "bg-teal-400/10 text-teal-300" : action.tone === "blue" ? "bg-blue-500/10 text-blue-300" : "bg-amber-400/10 text-amber-300";
            return <button key={action.title} type="button" onClick={() => finish(action.destination)} className="group rounded-2xl border border-white/10 bg-slate-950/50 p-7 text-left shadow-2xl backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-teal-400/30 hover:bg-slate-900/70">
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold ${iconTone}`}>{action.icon}</span>
              <span className="mt-6 block text-lg font-bold">{action.title}</span>
              <span className="mt-2 block min-h-12 text-sm leading-6 text-slate-400">{action.description}</span>
              <span className="mt-5 block text-sm font-bold text-teal-300 group-hover:text-teal-200">{action.label} →</span>
            </button>;
          })}
        </div>

        <button type="button" onClick={() => finish("/")} className="mt-10 inline-flex h-13 items-center rounded-xl bg-gradient-to-r from-teal-300 to-emerald-300 px-8 py-3.5 text-sm font-bold text-slate-950 shadow-xl shadow-teal-950/40 hover:from-teal-200 hover:to-emerald-200">Go to Dashboard <span className="ml-5">→</span></button>
        <div className="mt-12 text-xs text-slate-600">© 2026 SEnuke AI — All rights reserved.</div>
        <Link to="/privacy" className="sr-only">Privacy</Link>
      </div>
    </main>
  );
}
