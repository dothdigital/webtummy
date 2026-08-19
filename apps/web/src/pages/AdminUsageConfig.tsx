import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";

type Tab = "costs" | "limits" | "budgets" | "models";

type PlanLimit = {
  id: string;
  planCode: string;
  featureKey: string;
  monthlyLimit: number | null;
  dailyLimit: number | null;
  creditCost: number | null;
  hardBlocked: boolean;
  overageAllowed: boolean;
};

type FeatureCost = {
  id: string;
  featureKey: string;
  moduleName: string;
  label: string;
  description: string;
  defaultCreditCost: number;
  estimatedProviderCost: number;
  unitLabel: string;
  requiresApproval: boolean;
  requiresIntegration: boolean;
  cacheTtlMinutes: number;
  isActive: boolean;
  modelTier: "research" | "content" | null;
  defaultModel: string;
  planLimits: PlanLimit[];
};

type BudgetCap = {
  id: string;
  scope: string;
  scopeKey: string;
  monthlyCredits: number | null;
  monthlyCostUsd: number | null;
  isActive: boolean;
  alertAtPercent: number;
  client?: { name: string; plan: string };
};

type ModelRoute = {
  id: string;
  featureKey: string;
  planCode: string | null;
  provider: string;
  model: string;
  taskComplexity: string;
  isActive: boolean;
  sortOrder: number;
};

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function asNumber(value: string, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export default function AdminUsageConfig() {
  const [tab, setTab] = useState<Tab>("budgets");
  const [features, setFeatures] = useState<FeatureCost[]>([]);
  const [budgetCaps, setBudgetCaps] = useState<BudgetCap[]>([]);
  const [modelRoutes, setModelRoutes] = useState<ModelRoute[]>([]);
  const [selectedFeatureKey, setSelectedFeatureKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedFeature = useMemo(
    () => features.find((feature) => feature.featureKey === selectedFeatureKey) ?? features[0] ?? null,
    [features, selectedFeatureKey],
  );

  const load = async () => {
    const [featureResult, capResult, routeResult] = await Promise.all([
      api.get<{ features: FeatureCost[] }>("/api/admin/usage/feature-costs"),
      api.get<{ budgetCaps: BudgetCap[] }>("/api/admin/usage/budget-caps"),
      api.get<{ modelRoutes: ModelRoute[] }>("/api/admin/usage/model-routes"),
    ]);
    setFeatures(featureResult.features);
    setBudgetCaps(capResult.budgetCaps);
    setModelRoutes(routeResult.modelRoutes);
    setSelectedFeatureKey((current) => current || featureResult.features[0]?.featureKey || "");
  };

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load usage controls"));
  }, []);

  const patchFeature = (patch: Partial<FeatureCost>) => {
    if (!selectedFeature) return;
    setFeatures((current) => current.map((feature) => feature.id === selectedFeature.id ? { ...feature, ...patch } : feature));
  };

  const patchLimit = (limitId: string, patch: Partial<PlanLimit>) => {
    if (!selectedFeature) return;
    setFeatures((current) => current.map((feature) => feature.id !== selectedFeature.id ? feature : {
      ...feature,
      planLimits: feature.planLimits.map((limit) => limit.id === limitId ? { ...limit, ...patch } : limit),
    }));
  };

  const saveFeature = async () => {
    if (!selectedFeature) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/api/admin/usage/feature-costs/${selectedFeature.featureKey}`, {
        moduleName: selectedFeature.moduleName,
        label: selectedFeature.label,
        description: selectedFeature.description,
        defaultCreditCost: selectedFeature.defaultCreditCost,
        estimatedProviderCost: selectedFeature.estimatedProviderCost,
        unitLabel: selectedFeature.unitLabel,
        requiresApproval: selectedFeature.requiresApproval,
        requiresIntegration: selectedFeature.requiresIntegration,
        cacheTtlMinutes: selectedFeature.cacheTtlMinutes,
        isActive: selectedFeature.isActive,
      });
      setMessage("Feature cost saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save feature cost");
    } finally {
      setBusy(false);
    }
  };

  const saveLimit = async (limit: PlanLimit) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/api/admin/usage/plan-limits/${limit.planCode}/${limit.featureKey}`, {
        monthlyLimit: limit.monthlyLimit,
        dailyLimit: limit.dailyLimit,
        creditCost: limit.creditCost,
        hardBlocked: limit.hardBlocked,
        overageAllowed: limit.overageAllowed,
      });
      setMessage(`${titleCase(limit.planCode)} limit saved.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save plan limit");
    } finally {
      setBusy(false);
    }
  };

  const createWorkspaceCap = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/api/admin/usage/budget-caps", {
        scope: "workspace",
        scopeKey: "workspace",
        monthlyCredits: 1000,
        monthlyCostUsd: null,
        isActive: true,
        alertAtPercent: 80,
      });
      setMessage("Workspace budget cap created for the active admin client context.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create budget cap");
    } finally {
      setBusy(false);
    }
  };

  const createModelRoute = async () => {
    if (!selectedFeature) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/api/admin/usage/model-routes", {
        featureKey: selectedFeature.featureKey,
        planCode: null,
        taskComplexity: selectedFeature.modelTier === "research" ? "advanced" : "standard",
        provider: "openai",
        model: selectedFeature.defaultModel,
        isActive: true,
        sortOrder: 100,
      });
      setMessage("Model routing rule created.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create model route");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Usage & Cost Controls</h1>
          <p className="text-sm text-slate-500">Operational budget caps and AI model routing. Plan capacity, workflow units, seats, and add-ons are managed in Commercial Admin.</p>
        </div>
        <Button variant="ghost" onClick={() => void load()} disabled={busy}>Refresh</Button>
      </div>

      {message && <Card className="p-4 text-sm font-semibold text-slate-700">{message}</Card>}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Tracked workflows" value={features.length} />
        <Metric label="Retired plan-limit rows" value={features.reduce((sum, feature) => sum + feature.planLimits.length, 0)} />
        <Metric label="Budget caps" value={budgetCaps.length} />
        <Metric label="Model routes" value={modelRoutes.length} />
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {(["budgets", "models"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {item === "models" ? "Model Routing" : titleCase(item)}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <div className="font-bold text-charcoal-950">Feature Catalog</div>
            <p className="mt-1 text-xs text-slate-500">Select a workflow to configure model routing. Unit prices live in Commercial Admin.</p>
          </div>
          <div className="max-h-[620px] overflow-auto">
            {features.map((feature) => (
              <button
                key={feature.featureKey}
                type="button"
                onClick={() => setSelectedFeatureKey(feature.featureKey)}
                className={`block w-full border-b border-slate-100 p-4 text-left ${selectedFeature?.featureKey === feature.featureKey ? "bg-brand-50" : "hover:bg-slate-50"}`}
              >
                <div className="text-sm font-bold text-charcoal-950">{feature.label}</div>
                <div className="mt-1 text-xs text-slate-500">{titleCase(feature.moduleName)} · {feature.defaultCreditCost} capacity units</div>
              </button>
            ))}
          </div>
        </Card>

        {selectedFeature && tab === "costs" && (
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-charcoal-950">{selectedFeature.label}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedFeature.featureKey}</p>
              </div>
              <Button onClick={saveFeature} disabled={busy}>Save Feature Cost</Button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Label" value={selectedFeature.label} onChange={(value) => patchFeature({ label: value })} />
              <Field label="Module" value={selectedFeature.moduleName} onChange={(value) => patchFeature({ moduleName: value })} />
              <Field label="Default credits" type="number" value={String(selectedFeature.defaultCreditCost)} onChange={(value) => patchFeature({ defaultCreditCost: asNumber(value) })} />
              <Field label="Estimated provider cost" type="number" value={String(selectedFeature.estimatedProviderCost)} onChange={(value) => patchFeature({ estimatedProviderCost: asNumber(value) })} />
              <Field label="Unit label" value={selectedFeature.unitLabel} onChange={(value) => patchFeature({ unitLabel: value })} />
              <Field label="Cache TTL minutes" type="number" value={String(selectedFeature.cacheTtlMinutes)} onChange={(value) => patchFeature({ cacheTtlMinutes: asNumber(value) })} />
            </div>
            <label className="mt-4 block text-sm font-bold text-slate-700">Description</label>
            <textarea value={selectedFeature.description} onChange={(event) => patchFeature({ description: event.target.value })} className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
            <div className="mt-4 flex flex-wrap gap-4">
              <Check label="Active" checked={selectedFeature.isActive} onChange={(checked) => patchFeature({ isActive: checked })} />
              <Check label="Requires approval" checked={selectedFeature.requiresApproval} onChange={(checked) => patchFeature({ requiresApproval: checked })} />
              <Check label="Requires integration" checked={selectedFeature.requiresIntegration} onChange={(checked) => patchFeature({ requiresIntegration: checked })} />
            </div>
          </Card>
        )}

        {selectedFeature && tab === "limits" && (
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-bold text-charcoal-950">Plan limits for {selectedFeature.label}</h2>
              <p className="mt-1 text-sm text-slate-500">These values control whether users can run the feature, how often, and how many credits it costs.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {selectedFeature.planLimits.map((limit) => (
                <div key={limit.id} className="grid gap-3 p-4 xl:grid-cols-[140px_120px_120px_120px_160px] xl:items-center">
                  <div className="font-bold text-charcoal-950">{titleCase(limit.planCode)}</div>
                  <SmallField label="Monthly" value={limit.monthlyLimit ?? ""} onChange={(value) => patchLimit(limit.id, { monthlyLimit: value === "" ? null : asNumber(String(value)) })} />
                  <SmallField label="Daily" value={limit.dailyLimit ?? ""} onChange={(value) => patchLimit(limit.id, { dailyLimit: value === "" ? null : asNumber(String(value)) })} />
                  <SmallField label="Credits" value={limit.creditCost ?? ""} onChange={(value) => patchLimit(limit.id, { creditCost: value === "" ? null : asNumber(String(value)) })} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Check label="Blocked" checked={limit.hardBlocked} onChange={(checked) => patchLimit(limit.id, { hardBlocked: checked })} />
                    <Check label="Overage" checked={limit.overageAllowed} onChange={(checked) => patchLimit(limit.id, { overageAllowed: checked })} />
                    <Button variant="ghost" onClick={() => void saveLimit(limit)} disabled={busy}>Save</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === "budgets" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="font-bold text-charcoal-950">Budget caps</h2>
                <p className="mt-1 text-sm text-slate-500">Caps stop unexpected credit burn or provider spend before execution.</p>
              </div>
              <Button onClick={createWorkspaceCap} disabled={busy}>Create Workspace Cap</Button>
            </div>
            <div className="divide-y divide-slate-100">
              {budgetCaps.map((cap) => (
                <div key={cap.id} className="grid gap-3 p-4 xl:grid-cols-[1fr_140px_140px_120px] xl:items-center">
                  <div>
                    <div className="font-bold text-charcoal-950">{cap.client?.name ?? "Client"} · {titleCase(cap.scope)}</div>
                    <div className="text-sm text-slate-500">{cap.scopeKey}</div>
                  </div>
                  <div className="text-sm text-slate-700">{cap.monthlyCredits ?? "No"} credits</div>
                  <div className="text-sm text-slate-700">{cap.monthlyCostUsd != null ? `$${cap.monthlyCostUsd}` : "No cost cap"}</div>
                  <div className="text-sm font-bold text-slate-700">{cap.isActive ? "Active" : "Inactive"}</div>
                </div>
              ))}
              {!budgetCaps.length && <div className="p-5 text-sm text-slate-500">No budget caps yet.</div>}
            </div>
          </Card>
        )}

        {selectedFeature && tab === "models" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="font-bold text-charcoal-950">Model routing</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Default: <span className="font-semibold text-slate-700">{selectedFeature.defaultModel}</span>
                  {selectedFeature.modelTier ? ` · ${titleCase(selectedFeature.modelTier)} tier` : ""}. Add a rule only when this feature or plan needs an override.
                </p>
              </div>
              <Button onClick={createModelRoute} disabled={busy}>Add Route</Button>
            </div>
            <div className="divide-y divide-slate-100">
              {modelRoutes.filter((route) => route.featureKey === selectedFeature.featureKey).map((route) => (
                <div key={route.id} className="grid gap-3 p-4 xl:grid-cols-[1fr_120px_180px_120px] xl:items-center">
                  <div>
                    <div className="font-bold text-charcoal-950">{route.model}</div>
                    <div className="text-sm text-slate-500">{route.provider} · {route.taskComplexity}</div>
                  </div>
                  <div className="text-sm text-slate-700">{route.planCode ?? "All plans"}</div>
                  <div className="text-sm text-slate-700">Sort {route.sortOrder}</div>
                  <div className="text-sm font-bold text-slate-700">{route.isActive ? "Active" : "Inactive"}</div>
                </div>
              ))}
              {!modelRoutes.some((route) => route.featureKey === selectedFeature.featureKey) && <div className="p-5 text-sm text-slate-500">No override is configured. This feature currently uses {selectedFeature.defaultModel} from the {selectedFeature.modelTier ?? "default"} model policy.</div>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-bold text-charcoal-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </Card>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <input value={value} type={type} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
    </label>
  );
}

function SmallField({ label, value, onChange }: { label: string; value: number | ""; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-bold text-slate-500">
      {label}
      <input value={value} type="number" onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-400" />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
      {label}
    </label>
  );
}
