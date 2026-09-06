import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

export type WebsitePlanSuggestion = {
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  title: string;
  pageMode?: "match_or_create" | "create_supporting" | "add_faq" | "reject";
  targetUrl?: string | null;
  parentTargetUrl?: string | null;
  evidence: string;
  recommendedAction: string;
  expectedImpact?: string;
};

type PlanRequirement = { findingKey?: string };
type PlanPage = { id: string; title: string; slug: string; targetUrl: string | null; remoteUrl: string | null; status: string; briefJson?: { seoPlan?: { gapRequirements?: PlanRequirement[] } } };
type PlanOverview = { build: { pages: PlanPage[] } | null };

function path(value: string | null | undefined) {
  if (!value) return "";
  try { return new URL(value, "https://senuke.local").pathname.replace(/\/+$/, "").toLowerCase() || "/"; }
  catch { return value.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "").toLowerCase() || "/"; }
}

export default function WebsitePlanSuggestionAction({ projectId, suggestion, className = "", onAdded, answerOpportunity = false }: { projectId: string; suggestion: WebsitePlanSuggestion; className?: string; onAdded?: (result: { status: string; pageId: string | null; pageTitle: string | null }) => void; answerOpportunity?: boolean }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<PlanOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addedPageId, setAddedPageId] = useState<string | null>(null);
  const [decision, setDecision] = useState("");
  useEffect(() => { let cancelled = false; void api.get<PlanOverview>(`/api/projects/${encodeURIComponent(projectId)}/website-builder`).then((result) => { if (!cancelled) setOverview(result); }).catch(() => { if (!cancelled) setOverview({ build: null }); }); return () => { cancelled = true; }; }, [projectId]);
  const page = useMemo(() => {
    if (suggestion.pageMode === "create_supporting") return null;
    const target = path(suggestion.targetUrl);
    if (!target) return null;
    return overview?.build?.pages.find((candidate) => candidate.status !== "deferred" && [candidate.targetUrl, candidate.remoteUrl, candidate.slug ? `/${candidate.slug}` : "/"].some((value) => path(value) === target)) ?? null;
  }, [overview, suggestion.targetUrl]);
  const findingKey = `${suggestion.sourceModule}:${suggestion.sourceType}:${suggestion.sourceId}`;
  const savedPage = useMemo(() => overview?.build?.pages.find((candidate) => candidate.briefJson?.seoPlan?.gapRequirements?.some((requirement) => requirement.findingKey === findingKey)) ?? null, [findingKey, overview]);
  const reviewPageId = addedPageId ?? savedPage?.id ?? null;
  const label = overview === null ? "Checking Website Plan…" : !overview.build ? "Save for SEO Plan" : reviewPageId ? "Added to Website Development — Review" : "Add to Website Development";
  function review() {
    if (!reviewPageId) return;
    navigate(`/site-architect?projectId=${encodeURIComponent(projectId)}&step=structure&pageId=${encodeURIComponent(reviewPageId)}&sourceSuggestion=${encodeURIComponent(findingKey)}`);
  }
  async function decide(pageMode: WebsitePlanSuggestion["pageMode"] = suggestion.pageMode) {
    if (reviewPageId && pageMode !== "reject") { review(); return; }
    setBusy(true); setError("");
    try {
      const result = await api.post<{ status: string; pageId: string | null; pageTitle: string | null; destinationUrl: string }>(`/api/projects/${encodeURIComponent(projectId)}/website-builder/plan-suggestions`, { ...suggestion, pageMode });
      onAdded?.(result);
      setDecision(result.status);
      if (result.pageId) setAddedPageId(result.pageId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The suggestion could not be saved to the governed website workflow."); }
    finally { setBusy(false); }
  }
  if (decision === "rejected") return <div className="text-xs font-bold text-slate-500">Not interested · excluded from Website Plan</div>;
  if (decision === "saved_for_seo_plan") return <div><span className="inline-flex rounded-lg bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800">Added to SEO Plan</span></div>;
  if (answerOpportunity) return <div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || overview === null} onClick={() => void decide("add_faq")} className={className || "rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"}>{busy ? "Saving…" : "Add as FAQ"}</button><button type="button" disabled={busy || overview === null} onClick={() => void decide("create_supporting")} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">Create supporting page</button><button type="button" disabled={busy || overview === null} onClick={() => void decide("reject")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50">Not interested</button></div>{decision === "added_as_faq" && <p className="mt-1 text-[11px] font-semibold text-emerald-700">Added as an FAQ and FAQPage schema requirement on the matched page.</p>}{error && <p className="mt-1 text-[11px] font-semibold text-rose-700">{error}</p>}</div>;
  return <div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || overview === null} onClick={() => void decide()} className={className || "rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"}>{busy ? "Saving…" : label}{reviewPageId ? " →" : ""}</button><button type="button" disabled={busy || overview === null} onClick={() => void decide("reject")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50">Not interested</button></div>{error && <p className="mt-1 text-[11px] font-semibold text-rose-700">{error}</p>}</div>;
}
