import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, completeWelcome } from "../api.js";
import { Logo } from "../components/Logo.js";

type WorkspaceWelcome = {
  workspace: { name: string; workspaceType: string };
  summary: { clients: number };
};

function ActionIcon({ kind }: { kind: "client" | "team" | "project" }) {
  if (kind === "client") return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>;
  if (kind === "team") return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2.5A5.5 5.5 0 0 1 10.5 13h3A5.5 5.5 0 0 1 19 18.5V21" /></svg>;
  return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v6h5" /></svg>;
}

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
    { title: agency ? "Add your first client" : "Set up your workspace", description: agency ? "Set up client details, sites, and target markets." : "Add your business details and shared defaults.", label: agency ? "Add client" : "Open workspace", destination: agency ? "/workspace?tab=clients" : "/workspace", tone: "teal", icon: "client" as const },
    { title: "Invite your team", description: "Bring in teammates and assign roles like Manager or Editor.", label: "Invite team", destination: "/workspace?tab=teams", tone: "blue", icon: "team" as const },
    { title: "Start a project", description: "Kick off intake, keyword research, and strategy.", label: "New project", destination: "/projects/new", tone: "amber", icon: "project" as const },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#061112] px-5 py-6 text-white sm:px-8 lg:px-12">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(45,212,191,0.13)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.13)_1px,transparent_1px)] [background-size:86px_86px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.08),transparent_62%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1750px] flex-col items-center">
        <div className="rounded-[26px] border border-white/[0.03] bg-[#171d25] px-6 py-4 shadow-2xl"><Logo size={30} /></div>
        <div className="mt-20 rounded-full border border-teal-400/30 bg-teal-400/10 px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-teal-300 sm:mt-24"><span className="mr-3 inline-block h-2.5 w-2.5 rounded-full bg-teal-500/70" />Workspace ready</div>
        <h1 className="mt-10 text-center text-4xl font-bold tracking-[-0.035em] text-slate-100 sm:text-6xl lg:text-[68px]">Welcome to {workspaceName}</h1>
        <p className="mt-7 max-w-4xl text-center text-lg leading-8 text-slate-400 sm:text-2xl sm:leading-[1.55]">Your {agency ? "agency " : ""}workspace is set up. {agency ? "Add your first client, invite your team, or jump straight into the dashboard." : "Choose where you want to begin, or go directly to your dashboard."}</p>

        <div className="mt-14 grid w-full gap-5 md:grid-cols-3 lg:mt-20 lg:gap-8">
          {actions.map((action) => {
            const iconTone = action.tone === "teal" ? "bg-teal-400/10 text-teal-300" : action.tone === "blue" ? "bg-blue-500/10 text-blue-300" : "bg-amber-400/10 text-amber-300";
            return <button key={action.title} type="button" onClick={() => finish(action.destination)} className="group min-h-[280px] rounded-[28px] border border-slate-700/60 bg-[#0b1218]/90 p-8 text-left shadow-2xl backdrop-blur-sm transition hover:-translate-y-1 hover:border-teal-400/30 hover:bg-[#101920] lg:min-h-[370px] lg:p-11">
              <span className={`flex h-16 w-16 items-center justify-center rounded-[20px] ${iconTone}`}><ActionIcon kind={action.icon} /></span>
              <span className="mt-8 block text-xl font-bold text-slate-100 lg:text-2xl">{action.title}</span>
              <span className="mt-3 block min-h-14 text-base leading-7 text-slate-400 lg:text-xl lg:leading-8">{action.description}</span>
              <span className="mt-6 block text-base font-bold text-teal-300 group-hover:text-teal-200 lg:text-xl">{action.label} →</span>
            </button>;
          })}
        </div>

        <button type="button" onClick={() => finish("/")} className="mt-14 inline-flex items-center rounded-[18px] bg-gradient-to-r from-teal-300 to-emerald-400 px-10 py-4 text-base font-bold text-slate-950 shadow-xl shadow-teal-950/50 hover:from-teal-200 hover:to-emerald-300 lg:px-14 lg:py-5 lg:text-xl">Go to Dashboard <span className="ml-8">→</span></button>
        <div className="mb-2 mt-auto pt-16 text-sm text-slate-600 sm:text-base">© 2026 SEnuke.com — All rights reserved.</div>
        <Link to="/privacy" className="sr-only">Privacy</Link>
      </div>
    </main>
  );
}
