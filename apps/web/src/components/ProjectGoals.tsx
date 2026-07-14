import { primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";

export default function ProjectGoals({ workspaceType, primaryGoal, secondaryGoals, onChange }: {
  workspaceType: string; primaryGoal: string; secondaryGoals: string[];
  onChange: (value: { primaryGoal: string; secondaryGoals: string[] }) => void;
}) {
  const toggleSecondary = (goal: string) => onChange({ primaryGoal, secondaryGoals: secondaryGoals.includes(goal) ? secondaryGoals.filter((item) => item !== goal) : [...secondaryGoals, goal] });
  return <div className="space-y-4 md:col-span-2">
    <label className="block"><span className="mb-1 block text-sm font-bold text-slate-800">Primary Goal *</span><select required value={primaryGoal} onChange={(event) => onChange({ primaryGoal: event.target.value, secondaryGoals: secondaryGoals.filter((goal) => goal !== event.target.value) })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"><option value="">Select one primary goal</option>{primaryGoalsForWorkspace(workspaceType).map((goal) => <option key={goal} value={goal}>{goal}</option>)}</select><span className="mt-1 block text-xs text-slate-500">This is the single objective used to prioritize recommendations and tasks.</span></label>
    <fieldset><legend className="text-sm font-bold text-slate-800">Secondary Goals (optional)</legend><p className="mt-1 text-xs text-slate-500">Select any supporting outcomes. They influence Strategy and Execution but never replace the Primary Goal.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{standardSecondaryGoals.map((goal) => <label key={goal} className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-sm ${secondaryGoals.includes(goal) ? "border-brand-300 bg-brand-50 text-brand-900" : "border-slate-200 bg-white text-slate-700"}`}><input type="checkbox" checked={secondaryGoals.includes(goal)} onChange={() => toggleSecondary(goal)} /><span className="font-semibold">{goal}</span></label>)}</div></fieldset>
  </div>;
}
