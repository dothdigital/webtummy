import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { ActionIconButton, Button, Card, Input, StatusPill } from "../components/ui.js";
import type { BillingPlan } from "../types.js";

type PlanDraft = Omit<BillingPlan, "priceMonthly" | "articles" | "helperDailyLimit" | "memberCount"> & { memberCount?: number };

const emptyDraft: PlanDraft = {
  code: "",
  name: "",
  description: "<p></p>",
  priceMonthlyCents: 0,
  articleLimit: 0,
  helperMonthlyLimit: 0,
  features: [],
  stripeProductId: null,
  stripePriceId: null,
  isActive: true,
  sortOrder: 100,
};

function toDraft(plan: BillingPlan): PlanDraft {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMonthlyCents: plan.priceMonthlyCents,
    articleLimit: plan.articleLimit,
    helperMonthlyLimit: plan.helperMonthlyLimit,
    features: plan.features,
    stripeProductId: plan.stripeProductId,
    stripePriceId: plan.stripePriceId,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    memberCount: plan.memberCount,
  };
}

function plainText(html: string) {
  return html.replace(/<li>/gi, " - ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function featureText(features: string[]) {
  return features.join("\n");
}

function parseFeatures(value: string) {
  return value.split("\n").map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function RichTextEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = value || "<p></p>";
  }, [value]);

  const run = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command);
    onChange(editorRef.current?.innerHTML ?? "");
  };

  return (
    <label className="block lg:col-span-3">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-2">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("bold")} className="h-8 min-w-8 rounded-md px-2 text-sm font-bold text-slate-700 hover:bg-white" title="Bold">B</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("italic")} className="h-8 min-w-8 rounded-md px-2 text-sm italic text-slate-700 hover:bg-white" title="Italic">I</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("underline")} className="h-8 min-w-8 rounded-md px-2 text-sm underline text-slate-700 hover:bg-white" title="Underline">U</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertUnorderedList")} className="h-8 rounded-md px-3 text-sm text-slate-700 hover:bg-white" title="Bullet list">Bullets</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertOrderedList")} className="h-8 rounded-md px-3 text-sm text-slate-700 hover:bg-white" title="Numbered list">Numbers</button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => onChange(event.currentTarget.innerHTML)}
          className="min-h-32 w-full px-3 py-2 text-sm leading-6 text-slate-800 outline-none [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc"
        />
      </div>
    </label>
  );
}

function PlanForm({ draft, mode, busy, onChange, onCancel, onSubmit }: { draft: PlanDraft; mode: "create" | "edit"; busy: boolean; onChange: (patch: Partial<PlanDraft>) => void; onCancel: () => void; onSubmit: () => void }) {
  const [featuresValue, setFeaturesValue] = useState(featureText(draft.features));

  useEffect(() => {
    setFeaturesValue(featureText(draft.features));
  }, [draft.code]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-lg font-bold text-charcoal-900">{mode === "create" ? "Add plan" : `Edit ${draft.name}`}</div>
            <div className="text-sm text-charcoal-500">Use the description editor for bullets and formatted plan copy.</div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : mode === "create" ? "Create plan" : "Save changes"}</Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Input label="Code" value={draft.code} onChange={(value) => onChange({ code: value.toLowerCase().replace(/\s+/g, "-") })} placeholder="agency-pro" />
          <Input label="Name" value={draft.name} onChange={(value) => onChange({ name: value })} />
          <Input label="Sort order" type="number" value={String(draft.sortOrder)} onChange={(value) => onChange({ sortOrder: Number(value) })} />
          <Input label="Price monthly cents" type="number" value={String(draft.priceMonthlyCents)} onChange={(value) => onChange({ priceMonthlyCents: Number(value) })} />
          <Input label="Article limit" type="number" value={String(draft.articleLimit)} onChange={(value) => onChange({ articleLimit: Number(value) })} />
          <Input label="Helper monthly limit" type="number" value={String(draft.helperMonthlyLimit)} onChange={(value) => onChange({ helperMonthlyLimit: Number(value) })} />
          <RichTextEditor label="Description" value={draft.description} onChange={(description) => onChange({ description })} />
          <label className="block lg:col-span-3">
            <span className="mb-1 block text-sm font-medium text-slate-600">Features, one per line</span>
            <textarea
              value={featuresValue}
              onChange={(event) => {
                setFeaturesValue(event.target.value);
                onChange({ features: parseFeatures(event.target.value) });
              }}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-charcoal-700">
            <input type="checkbox" checked={draft.isActive} onChange={(event) => onChange({ isActive: event.target.checked })} className="h-4 w-4 rounded border-charcoal-300" />
            Active for new purchases
          </label>
        </div>
      </form>
    </Card>
  );
}

export default function AdminPlans() {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [draft, setDraft] = useState<PlanDraft>(emptyDraft);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<{ plans: BillingPlan[] }>("/api/billing/plans");
      setPlans(result.plans);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (plan: BillingPlan) => {
    setMessage(null);
    setShowCreate(false);
    setEditingCode(plan.code);
    setDraft(toDraft(plan));
  };

  const startCreate = () => {
    setMessage(null);
    setEditingCode(null);
    setShowCreate(true);
    setDraft({ ...emptyDraft, sortOrder: (plans.at(-1)?.sortOrder ?? 90) + 10 });
  };

  const cancelForm = () => {
    setShowCreate(false);
    setEditingCode(null);
    setDraft(emptyDraft);
  };

  const planPayload = (input: PlanDraft) => ({
    code: input.code,
    name: input.name,
    description: input.description,
    priceMonthlyCents: Number(input.priceMonthlyCents),
    articleLimit: Number(input.articleLimit),
    helperMonthlyLimit: Number(input.helperMonthlyLimit),
    stripeProductId: input.stripeProductId || null,
    stripePriceId: input.stripePriceId || null,
    isActive: input.isActive,
    sortOrder: Number(input.sortOrder),
    features: input.features,
  });

  const save = async () => {
    setBusyCode(draft.code || "new");
    setMessage(null);
    try {
      if (showCreate) {
        const result = await api.post<{ plan: BillingPlan }>("/api/billing/plans", planPayload(draft));
        setPlans((current) => [...current, result.plan].sort((a, b) => a.sortOrder - b.sortOrder || a.priceMonthlyCents - b.priceMonthlyCents));
        setMessage(`${result.plan.name} created.`);
      } else if (editingCode) {
        const result = await api.patch<{ plan: BillingPlan }>(`/api/billing/plans/${editingCode}`, planPayload(draft));
        setPlans((current) => current.map((plan) => (plan.code === editingCode ? result.plan : plan)));
        setMessage(`${result.plan.name} updated.`);
      }
      cancelForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save plan");
    } finally {
      setBusyCode(null);
    }
  };

  const toggleActive = async (plan: BillingPlan) => {
    setBusyCode(plan.code);
    setMessage(null);
    try {
      const result = await api.patch<{ plan: BillingPlan }>(`/api/billing/plans/${plan.code}`, { isActive: !plan.isActive });
      setPlans((current) => current.map((item) => (item.code === plan.code ? result.plan : item)));
      setMessage(`${result.plan.name} ${result.plan.isActive ? "activated" : "deactivated"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update plan");
    } finally {
      setBusyCode(null);
    }
  };

  const deletePlan = async (plan: BillingPlan) => {
    if ((plan.memberCount ?? 0) > 0) {
      setMessage(`Cannot delete ${plan.name}; ${plan.memberCount} client account${plan.memberCount === 1 ? " is" : "s are"} using it.`);
      return;
    }
    if (!window.confirm(`Delete ${plan.name}? This cannot be undone.`)) return;
    setBusyCode(plan.code);
    setMessage(null);
    try {
      await api.delete(`/api/billing/plans/${plan.code}`);
      setPlans((current) => current.filter((item) => item.code !== plan.code));
      if (editingCode === plan.code) cancelForm();
      setMessage(`${plan.name} deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete plan");
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-900">Plan Management</h1>
          <p className="mt-1 text-sm text-charcoal-500">Manage available plans from one list. Plans with client accounts attached cannot be deleted.</p>
        </div>
        <Button onClick={startCreate}>Add plan</Button>
      </div>

      {message && <Card className="p-4 text-sm text-charcoal-600">{message}</Card>}

      {(showCreate || editingCode) && (
        <PlanForm draft={draft} mode={showCreate ? "create" : "edit"} busy={busyCode === draft.code || busyCode === "new"} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} onCancel={cancelForm} onSubmit={save} />
      )}

      {loading ? (
        <Card className="p-6 text-sm text-charcoal-400">Loading plans...</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                <tr>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Limits</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {plans.map((plan) => (
                  <tr key={plan.code} className="align-top">
                    <td className="max-w-sm px-4 py-4">
                      <div className="font-semibold text-charcoal-900">{plan.name}</div>
                      <div className="mt-0.5 text-xs uppercase text-charcoal-400">{plan.code}</div>
                      <div className="mt-2 line-clamp-2 text-sm text-charcoal-500">{plainText(plan.description)}</div>
                    </td>
                    <td className="px-4 py-4 font-semibold text-charcoal-900">${plan.priceMonthly}/mo</td>
                    <td className="px-4 py-4 text-charcoal-600">
                      <div>{plan.articleLimit} articles</div>
                      <div>{plan.helperMonthlyLimit} helper generations</div>
                    </td>
                    <td className="px-4 py-4 text-charcoal-600">{plan.memberCount ?? 0}</td>
                    <td className="px-4 py-4"><StatusPill status={plan.isActive ? "active" : "inactive"} /></td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <ActionIconButton
                          icon={plan.isActive ? "disable" : "enable"}
                          label={plan.isActive ? "Deactivate plan" : "Activate plan"}
                          onClick={() => toggleActive(plan)}
                          disabled={busyCode === plan.code}
                        />
                        <ActionIconButton
                          icon="edit"
                          label="Edit plan"
                          onClick={() => startEdit(plan)}
                          disabled={busyCode === plan.code}
                        />
                        <ActionIconButton
                          icon="trash"
                          label={(plan.memberCount ?? 0) > 0 ? "Cannot delete plan with members" : "Delete plan"}
                          onClick={() => deletePlan(plan)}
                          disabled={busyCode === plan.code || (plan.memberCount ?? 0) > 0}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
