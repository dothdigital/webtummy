import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { AutomationPolicy, GuidedExecutionTask } from "../types.js";

type Level = { key: string; label: string; meaning: string };
type Tab = "overview" | "rules" | "coverage" | "audit";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function policyTone(category: string) {
  if (category === "safe") return "bg-emerald-50 text-emerald-700";
  if (category === "blocked") return "bg-rose-50 text-rose-700";
  if (category === "restricted") return "bg-amber-50 text-amber-700";
  return "bg-brand-50 text-brand-700";
}

export default function AutomationCenter() {
  const [tab, setTab] = useState<Tab>("overview");
  const [levels, setLevels] = useState<Level[]>([]);
  const [policies, setPolicies] = useState<AutomationPolicy[]>([]);
  const [blockedRules, setBlockedRules] = useState<string[]>([]);
  const [recentTasks, setRecentTasks] = useState<GuidedExecutionTask[]>([]);
  const [summary, setSummary] = useState<{ blockedTasks: number; approvalTasks: number; integrationTasks: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ levels: Level[]; policies: AutomationPolicy[]; blockedRules: string[] }>("/api/automation/overview")
      .then((result) => {
        setLevels(result.levels);
        setPolicies(result.policies);
        setBlockedRules(result.blockedRules);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load automation overview"));
    api.get<{ recentTasks: GuidedExecutionTask[]; summary: { blockedTasks: number; approvalTasks: number; integrationTasks: number } }>("/api/automation/audit-log")
      .then((result) => {
        setRecentTasks(result.recentTasks);
        setSummary(result.summary);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Automation Center</h1>
          <p className="text-sm text-slate-500">Central policy for safe automation, approvals, integrations, and manual guidance across SEnuke AI modules.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setTab("coverage")}>View Automation Map</Button>
          <Button variant="ghost" onClick={() => setTab("audit")}>Review Approvals</Button>
        </div>
      </div>

      {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>}

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {(["overview", "rules", "coverage", "audit"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {item === "audit" ? "Audit Log" : titleCase(item)}
            </button>
          ))}
        </div>
      </Card>

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Automation all layers overview</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {policies.filter((policy) => ["keyword_research", "site_analysis", "publishing", "social_strategy", "growth_marketing", "agency"].includes(policy.key)).map((policy) => (
                <div key={policy.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-charcoal-950">{policy.label}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${policyTone(policy.safetyCategory)}`}>{titleCase(policy.safetyCategory)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{policy.coverage}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {policy.levels.map((level) => <span key={level} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{titleCase(level)}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Automation summary</h2>
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg bg-slate-50 p-4"><div className="text-2xl font-bold text-charcoal-950">{policies.length}</div><div className="text-sm text-slate-500">covered modules</div></div>
              <div className="rounded-lg bg-slate-50 p-4"><div className="text-2xl font-bold text-charcoal-950">{summary?.approvalTasks ?? 0}</div><div className="text-sm text-slate-500">approval-gated tasks</div></div>
              <div className="rounded-lg bg-slate-50 p-4"><div className="text-2xl font-bold text-charcoal-950">{summary?.integrationTasks ?? 0}</div><div className="text-sm text-slate-500">integration-required tasks</div></div>
            </div>
          </Card>
        </div>
      )}

      {tab === "rules" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Automation approval rules</h2>
            <div className="mt-5 grid gap-3">
              {levels.map((level, index) => (
                <div key={level.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{index + 1}</div>
                    <div>
                      <div className="font-bold text-charcoal-950">{level.label}</div>
                      <div className="text-sm text-slate-500">{level.meaning}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Blocked automation rules</h2>
            <div className="mt-4 space-y-3">
              {blockedRules.map((rule) => <div key={rule} className="rounded-lg bg-rose-50 p-3 text-sm leading-6 text-rose-800">{rule}</div>)}
            </div>
          </Card>
        </div>
      )}

      {tab === "coverage" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Module automation coverage</h2>
            <p className="mt-1 text-sm text-slate-500">Read from central automation policy configuration.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {policies.map((policy) => (
              <div key={policy.key} className="grid gap-3 p-4 xl:grid-cols-[220px_1fr_240px_180px] xl:items-center">
                <div className="font-bold text-charcoal-950">{policy.label}</div>
                <div className="text-sm leading-6 text-slate-600">{policy.coverage}</div>
                <div className="flex flex-wrap gap-2">{policy.levels.map((level) => <span key={level} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{titleCase(level)}</span>)}</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${policyTone(policy.safetyCategory)}`}>{policy.approvalRequirement}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "audit" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Automation log and safety audit</h2>
            <p className="mt-1 text-sm text-slate-500">Recent execution tasks by automation level, approval state, integration need, and safety category.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {recentTasks.map((task) => (
              <div key={task.id} className="grid gap-3 p-4 xl:grid-cols-[1fr_160px_160px_160px] xl:items-center">
                <div>
                  <div className="font-bold text-charcoal-950">{task.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{task.moduleName}</div>
                </div>
                <div className="text-sm font-semibold text-slate-700">{titleCase(task.automationLevel)}</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${policyTone(task.safetyCategory || "safe")}`}>{titleCase(task.safetyCategory || "safe")}</span>
                <div className="text-sm text-slate-500">{task.requiresApproval ? "Approval required" : task.requiresIntegration ? "Integration required" : "No approval gate"}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
