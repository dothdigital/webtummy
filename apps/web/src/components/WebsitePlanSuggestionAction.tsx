import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

export type WebsitePlanSuggestion = {
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  title: string;
  pageMode?: "match_or_create" | "create_supporting";
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

export default function WebsitePlanSuggestionAction({ projectId, suggestion, className = "", onAdded }: { projectId: string; suggestion: WebsitePlanSuggestion; className?: string; onAdded?: (result: { status: string; pageId: string | null; pageTitle: string | null }) => void }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<PlanOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addedPageId, setAddedPageId] = useState<string | null>(null);
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
  const label = overview === null ? "Checking Website Plan…" : !overview.build ? "Start Website Plan" : reviewPageId ? "Added to Website Plan — Review" : "Add to Website Plan";
  function review() {
    if (!reviewPageId) return;
    navigate(`/site-architect?projectId=${encodeURIComponent(projectId)}&step=structure&pageId=${encodeURIComponent(reviewPageId)}&sourceSuggestion=${encodeURIComponent(findingKey)}`);
  }
  async function add() {
    if (!overview?.build) { navigate(`/site-architect?projectId=${encodeURIComponent(projectId)}`); return; }
    if (reviewPageId) { review(); return; }
    setBusy(true); setError("");
    try {
      const result = await api.post<{ status: string; pageId: string | null; pageTitle: string | null; destinationUrl: string }>(`/api/projects/${encodeURIComponent(projectId)}/website-builder/plan-suggestions`, suggestion);
      onAdded?.(result);
      setAddedPageId(result.pageId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The suggestion could not be added to Website Plan."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy || overview === null} onClick={() => void add()} className={className || "rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"}>{busy ? "Adding to Website Plan…" : label}{reviewPageId ? " →" : ""}</button>{error && <p className="mt-1 text-[11px] font-semibold text-rose-700">{error}</p>}</div>;
}
