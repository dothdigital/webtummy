import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { AutomationPolicy, GuidedExecutionTask } from "../types.js";

type Level = { key: string; label: string; meaning: string };
type Tab = "overview" | "rules" | "coverage" | "audit";
type PolicyForm = Pick<AutomationPolicy, "label" | "coverage" | "levels" | "approvalRequirement" | "safetyCategory" | "examples">;
type TaskForm = Pick<GuidedExecutionTask, "automationLevel" | "safetyCategory" | "requiresApproval" | "requiresIntegration" | "manualRequired" | "status" | "blockedReason" | "manualInstructions">;

const automationLevelOptions = ["recommend", "generate", "prepare", "execute_with_approval", "execute_through_integration", "manual_guided"];
const safetyOptions = ["safe", "review_required", "restricted", "blocked"];

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
  const [message, setMessage] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<AutomationPolicy | null>(null);
  const [policyForm, setPolicyForm] = useState<PolicyForm | null>(null);
  const [editingTask, setEditingTask] = useState<GuidedExecutionTask | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm | null>(null);
  const [saving, setSaving] = useState(false);

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

  const openPolicyEditor = (policy: AutomationPolicy) => {
    setEditingPolicy(policy);
    setPolicyForm({
      label: policy.label,
      coverage: policy.coverage,
      levels: policy.levels,
      approvalRequirement: policy.approvalRequirement,
      safetyCategory: policy.safetyCategory,
      examples: policy.examples,
    });
  };

  const savePolicy = async () => {
    if (!editingPolicy || !policyForm) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.patch<{ policy: AutomationPolicy; policies: AutomationPolicy[] }>(`/api/automation/policies/${editingPolicy.key}`, policyForm);
      setPolicies(result.policies);
      setEditingPolicy(result.policy);
      setMessage("Automation policy updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update automation policy");
    } finally {
      setSaving(false);
    }
  };

  const openTaskEditor = (task: GuidedExecutionTask) => {
    setEditingTask(task);
    setTaskForm({
      automationLevel: task.automationLevel,
      safetyCategory: task.safetyCategory,
      requiresApproval: task.requiresApproval,
      requiresIntegration: task.requiresIntegration,
      manualRequired: task.manualRequired,
      status: task.status,
      blockedReason: task.blockedReason,
      manualInstructions: task.manualInstructions,
    });
  };

  const saveTask = async () => {
    if (!editingTask || !taskForm) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.patch<{ task: GuidedExecutionTask }>(`/api/automation/tasks/${editingTask.id}`, taskForm);
      setRecentTasks((current) => current.map((task) => task.id === result.task.id ? result.task : task));
      setEditingTask(result.task);
      setMessage("Automation task updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update automation task");
    } finally {
      setSaving(false);
    }
  };

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
      {message && <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</Card>}

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
        <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-bold text-charcoal-950">Module automation coverage</h2>
              <p className="mt-1 text-sm text-slate-500">Super admins can edit central policy configuration here.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {policies.map((policy) => (
                <button key={policy.key} type="button" onClick={() => openPolicyEditor(policy)} className={`grid w-full gap-3 p-4 text-left hover:bg-slate-50 xl:grid-cols-[220px_1fr_240px_180px] xl:items-center ${editingPolicy?.key === policy.key ? "bg-brand-50/70" : ""}`}>
                  <div className="font-bold text-charcoal-950">{policy.label}</div>
                  <div className="text-sm leading-6 text-slate-600">{policy.coverage}</div>
                  <div className="flex flex-wrap gap-2">{policy.levels.map((level) => <span key={level} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{titleCase(level)}</span>)}</div>
                  <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${policyTone(policy.safetyCategory)}`}>{policy.approvalRequirement}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">{editingPolicy ? "Edit automation policy" : "Select a policy"}</h2>
            {!policyForm ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">Choose a module policy from the coverage list to change its label, automation levels, safety category, approval rule, and examples.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <Field label="Label" value={policyForm.label} onChange={(value) => setPolicyForm({ ...policyForm, label: value })} />
                <TextArea label="Coverage" value={policyForm.coverage} onChange={(value) => setPolicyForm({ ...policyForm, coverage: value })} rows={4} />
                <TextArea label="Approval requirement" value={policyForm.approvalRequirement} onChange={(value) => setPolicyForm({ ...policyForm, approvalRequirement: value })} rows={3} />
                <Select label="Safety category" value={policyForm.safetyCategory} options={safetyOptions} onChange={(value) => setPolicyForm({ ...policyForm, safetyCategory: value })} />
                <CheckList label="Automation levels" options={automationLevelOptions} selected={policyForm.levels} onChange={(levels) => setPolicyForm({ ...policyForm, levels })} />
                <TextArea label="Examples" value={policyForm.examples.join("\n")} onChange={(value) => setPolicyForm({ ...policyForm, examples: value.split("\n").map((line) => line.trim()).filter(Boolean) })} rows={4} />
                <Button onClick={() => void savePolicy()} disabled={saving}>{saving ? "Saving..." : "Save Policy"}</Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "audit" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Automation log and safety audit</h2>
            <p className="mt-1 text-sm text-slate-500">Recent execution tasks by automation level, approval state, integration need, and safety category.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {recentTasks.map((task) => (
              <button key={task.id} type="button" onClick={() => openTaskEditor(task)} className={`grid w-full gap-3 p-4 text-left hover:bg-slate-50 xl:grid-cols-[1fr_160px_160px_160px] xl:items-center ${editingTask?.id === task.id ? "bg-brand-50/70" : ""}`}>
                <div>
                  <div className="font-bold text-charcoal-950">{task.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{task.moduleName}</div>
                </div>
                <div className="text-sm font-semibold text-slate-700">{titleCase(task.automationLevel)}</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${policyTone(task.safetyCategory || "safe")}`}>{titleCase(task.safetyCategory || "safe")}</span>
                <div className="text-sm text-slate-500">{task.requiresApproval ? "Approval required" : task.requiresIntegration ? "Integration required" : "No approval gate"}</div>
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 p-5">
            <h3 className="font-bold text-charcoal-950">{editingTask ? "Edit selected task" : "Select a task to edit"}</h3>
            {!taskForm ? (
              <p className="mt-2 text-sm text-slate-500">Choose an audit row to change automation level, safety category, approval gates, integration gate, status, and manual instructions.</p>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Select label="Automation level" value={taskForm.automationLevel} options={automationLevelOptions} onChange={(value) => setTaskForm({ ...taskForm, automationLevel: value })} />
                <Select label="Safety category" value={taskForm.safetyCategory || "safe"} options={safetyOptions} onChange={(value) => setTaskForm({ ...taskForm, safetyCategory: value })} />
                <Field label="Status" value={taskForm.status} onChange={(value) => setTaskForm({ ...taskForm, status: value })} />
                <div className="grid content-end gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={taskForm.requiresApproval} onChange={(event) => setTaskForm({ ...taskForm, requiresApproval: event.target.checked })} /> Requires approval</label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={taskForm.requiresIntegration} onChange={(event) => setTaskForm({ ...taskForm, requiresIntegration: event.target.checked })} /> Requires integration</label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={taskForm.manualRequired} onChange={(event) => setTaskForm({ ...taskForm, manualRequired: event.target.checked })} /> Manual required</label>
                </div>
                <div className="lg:col-span-2"><TextArea label="Blocked reason" value={taskForm.blockedReason ?? ""} onChange={(value) => setTaskForm({ ...taskForm, blockedReason: value || null })} rows={3} /></div>
                <div className="lg:col-span-2"><TextArea label="Manual instructions" value={taskForm.manualInstructions ?? ""} onChange={(value) => setTaskForm({ ...taskForm, manualInstructions: value || null })} rows={4} /></div>
                <div className="lg:col-span-2"><Button onClick={() => void saveTask()} disabled={saving}>{saving ? "Saving..." : "Save Task"}</Button></div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({ label, value, rows, onChange }: { label: string; value: string; rows: number; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
      </select>
    </label>
  );
}

function CheckList({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (selected: string[]) => void }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 grid gap-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))}
            />
            {titleCase(option)}
          </label>
        ))}
      </div>
    </div>
  );
}
