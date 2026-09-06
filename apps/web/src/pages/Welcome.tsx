import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, completeWelcome } from "../api.js";
import { Logo } from "../components/Logo.js";
import { workspaceExperience } from "../workspace-experience.js";
import { useAuth } from "../auth.js";

type WorkspaceWelcome = {
  workspace: { id: string; name: string; workspaceType: string };
  summary: { clients: number };
};

function ActionIcon({ kind }: { kind: "client" | "team" | "project" | "capacity" }) {
  if (kind === "client") return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>;
  if (kind === "team") return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2.5A5.5 5.5 0 0 1 10.5 13h3A5.5 5.5 0 0 1 19 18.5V21" /></svg>;
  if (kind === "capacity") return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
  return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v6h5" /></svg>;
}

export default function Welcome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<WorkspaceWelcome | null>(null);

  useEffect(() => {
    void api.get<WorkspaceWelcome>("/api/workspace").then(setData).catch(() => undefined);
  }, []);

  const workspaceName = data?.workspace.name ?? user?.workspace?.name ?? "Your Workspace";
  const experience = workspaceExperience(data?.workspace.workspaceType ?? user?.workspace?.type);
  const agency = experience.kind === "agency";

  function finish(destination: string) {
    completeWelcome(data?.workspace.id);
    navigate(destination, { replace: true });
  }

  const actions = experience.kind === "agency" ? [
    { title: "Add Your First Client", description: "Create a client record now. Choose this if you’re setting up clients before starting work.", label: "Add client", destination: "/workspace?tab=clients", tone: "teal", icon: "client" as const },
    { title: "Create a Client Project", description: "Start working immediately. If the client doesn’t exist yet, create them during project setup.", label: "Create client project", destination: "/projects/new?clientSetup=1", tone: "amber", icon: "project" as const },
    { title: "Invite Your Team", description: "Add team members now or later and assign them to clients and projects.", label: "Invite team", destination: "/workspace?tab=teams", tone: "blue", icon: "team" as const },
  ] : experience.kind === "business" ? [
    { title: "Set Up Your Business", description: "Add your business details, market, goals, and shared workspace defaults.", label: "Open business workspace", destination: "/workspace", tone: "teal", icon: "client" as const },
    { title: "Start Your First Project", description: "Begin intake, research, strategy, and the guided execution workflow.", label: "Create project", destination: "/projects/new", tone: "amber", icon: "project" as const },
    { title: "Invite Your Team", description: "Add the colleagues who will manage, edit, review, or approve business projects.", label: "Invite team", destination: "/workspace?tab=teams", tone: "blue", icon: "team" as const },
  ] : [
    { title: "Set Up Your Business", description: "Add your business details, target market, goals, and working preferences.", label: "Open my workspace", destination: "/workspace", tone: "teal", icon: "client" as const },
    { title: "Start Your First Project", description: "Begin intake, research, strategy, and the guided execution workflow.", label: "Create project", destination: "/projects/new", tone: "amber", icon: "project" as const },
    { title: "Review Your AI Capacity", description: "See how much AI Capacity is included, used, and still available this month.", label: "View capacity", destination: "/billing", tone: "blue", icon: "capacity" as const },
  ];

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#061112] px-5 py-4 text-white sm:px-8 lg:h-screen lg:overflow-hidden lg:px-12">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(45,212,191,0.13)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.13)_1px,transparent_1px)] [background-size:86px_86px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.08),transparent_62%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1600px] flex-col items-center lg:h-[calc(100vh-2rem)] lg:min-h-0">
        <div className="rounded-[22px] border border-white/[0.03] bg-[#171d25] px-5 py-3 shadow-2xl"><Logo size={28} /></div>
        <div className="mt-7 rounded-full border border-teal-400/30 bg-teal-400/10 px-5 py-2 text-xs font-bold uppercase tracking-wide text-teal-300 sm:mt-8 sm:text-sm"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-teal-500/70" />Workspace ready</div>
        <h1 className="mt-5 text-center text-4xl font-bold tracking-[-0.035em] text-slate-100 sm:text-5xl lg:text-[clamp(2.75rem,4.2vw,4rem)]">{agency ? "Welcome to Your Agency" : experience.kind === "business" ? "Welcome to Your Business Workspace" : `Welcome to ${workspaceName}`}</h1>
        <p className="mt-3 max-w-4xl text-center text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">{agency ? "Manage multiple clients and projects from one workspace." : experience.kind === "business" ? "Set up the business, invite colleagues, or start your first project." : "This is your single-user growth workspace. Set up the business, start a project, or review AI Capacity."}</p>

        {agency && <section className="mt-5 w-full rounded-2xl border border-teal-400/20 bg-teal-400/[0.06] px-4 py-3 sm:px-5">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-teal-300">Not sure where to start?</div>
          <p className="mt-1 text-sm leading-6 text-slate-300">Choose the path that matches how you want to begin. A client is still attached to every Agency project, but SEnuke AI - AI Growth Operating System can collect and create that client during the project setup flow.</p>
        </section>}

        <div className="mt-5 grid w-full gap-4 md:grid-cols-3 lg:gap-5">
          {actions.map((action) => {
            const iconTone = action.tone === "teal" ? "bg-teal-400/10 text-teal-300" : action.tone === "blue" ? "bg-blue-500/10 text-blue-300" : "bg-amber-400/10 text-amber-300";
            return <button key={action.title} type="button" onClick={() => finish(action.destination)} className="group rounded-[20px] border border-slate-700/60 bg-[#0b1218]/90 p-5 text-left shadow-2xl backdrop-blur-sm transition hover:-translate-y-1 hover:border-teal-400/30 hover:bg-[#101920]">
              <span className={`flex h-11 w-11 items-center justify-center rounded-[14px] ${iconTone}`}><ActionIcon kind={action.icon} /></span>
              <span className="mt-4 block text-lg font-bold text-slate-100">{action.title}</span>
              <span className="mt-2 block text-sm leading-6 text-slate-400">{action.description}</span>
              <span className="mt-4 block text-sm font-bold text-teal-300 group-hover:text-teal-200">{action.label} →</span>
            </button>;
          })}
        </div>

        {agency && <div className="mt-4 w-full rounded-xl border border-amber-300/20 bg-amber-300/[0.08] px-4 py-3 text-center text-xs leading-5 text-amber-100"><b>Tip:</b> Most agencies can simply click <b>Create a Client Project</b> to begin. If the client doesn’t already exist, SEnuke AI - AI Growth Operating System will create the client first and then continue with project setup.</div>}

        <button type="button" onClick={() => finish("/")} className="mt-5 inline-flex items-center rounded-[14px] bg-gradient-to-r from-teal-300 to-emerald-400 px-8 py-3 text-sm font-bold text-slate-950 shadow-xl shadow-teal-950/50 hover:from-teal-200 hover:to-emerald-300">Go to My Workspace <span className="ml-6">→</span></button>
        <div className="mb-1 mt-auto pt-4 text-xs text-slate-600 sm:text-sm">© 2026 SEnuke.com — All rights reserved.</div>
        <Link to="/privacy" className="sr-only">Privacy</Link>
      </div>
    </main>
  );
}
