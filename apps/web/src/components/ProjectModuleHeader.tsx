import ProjectExecutionBar from "./ProjectExecutionBar.js";
import type { GuidedExecutionTask, GuidedProject, ProjectNotification } from "../types.js";

export type ProjectHeaderAction = {
  key: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "status";
};

export default function ProjectModuleHeader({ eyebrow, title, subtitle, project, projects = [], tasks, notifications, onProjectChange, actions = [], showExecution = true }: {
  eyebrow: string;
  title: string;
  subtitle: string;
  project?: GuidedProject | null;
  projects?: GuidedProject[];
  tasks?: GuidedExecutionTask[];
  notifications?: ProjectNotification[];
  onProjectChange?: (projectId: string) => void;
  actions?: ProjectHeaderAction[];
  showExecution?: boolean;
}) {
  return <header>
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{eyebrow}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-[26px] font-bold leading-tight text-charcoal-950">{title}</h1>
          {project && showExecution && <ProjectExecutionBar project={project} tasks={tasks} notifications={notifications} />}
        </div>
        <p className="mt-1 text-sm text-charcoal-500">{subtitle}</p>
      </div>
      {project && <div className="flex max-w-full flex-wrap items-center gap-2">
        {projects.length > 1 && onProjectChange && <select value={project.id} onChange={(event) => onProjectChange(event.target.value)} className="h-10 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-charcoal-800 shadow-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" aria-label="Select project">{projects.map((item) => <option key={item.id} value={item.id}>{item.businessName || item.name}</option>)}</select>}
        {actions.map((action) => action.variant === "status"
          ? <span key={action.key} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-charcoal-600">{action.label}</span>
          : <button key={action.key} type="button" onClick={action.onClick} disabled={action.disabled} className={action.variant === "secondary" ? "rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 shadow-sm hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400" : "rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"}>{action.label}</button>)}
      </div>}
    </div>
  </header>;
}
