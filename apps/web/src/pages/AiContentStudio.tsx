import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import type { AiContentGeneration, AiContentStatus, AiGenerationType, Website } from "../types.js";
import { Button, Card, Input } from "../components/ui.js";

const GENERATION_TYPES: { value: AiGenerationType; label: string; detail: string }[] = [
  { value: "article", label: "Article", detail: "Full article with SEO fields, FAQ, schema, and AI-search notes." },
  { value: "h1", label: "H1 options", detail: "Generate focused H1 options for a specific page." },
  { value: "title", label: "SEO titles", detail: "Generate multiple title options." },
  { value: "meta_description", label: "Meta descriptions", detail: "Generate search-result descriptions." },
  { value: "faq", label: "FAQ section", detail: "Generate question and answer pairs." },
  { value: "page_schema", label: "Page schema", detail: "Generate JSON-LD for a specific page URL." },
  { value: "domain_schema", label: "Domain schema", detail: "Generate Organization/WebSite/domain-level JSON-LD." },
  { value: "page_llms_txt", label: "Page llms.txt", detail: "Generate an llms.txt section for a specific page." },
  { value: "domain_llms_txt", label: "Domain llms.txt", detail: "Generate a complete llms.txt file for the domain." },
  { value: "ai_search", label: "AI-search suggestions", detail: "Generate entity, LLM, and content-readiness recommendations." },
];

function prettyType(type: string) {
  return GENERATION_TYPES.find((item) => item.value === type)?.label ?? type;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function groupedTopic(topic: string) {
  return topic.replace(/ - (H1|SEO title|FAQ|Page schema|SEO titles|Meta descriptions|FAQ section|Page schema) improvements$/i, "");
}

type GenerationGroup = {
  key: string;
  topic: string;
  keyword: string | null;
  targetUrl: string | null;
  items: AiContentGeneration[];
  tokens: number;
  createdAt: string;
};

function FriendlyValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-lg border border-charcoal-100 bg-white p-3 text-sm text-charcoal-700">
            {typeof item === "object" && item !== null ? <FriendlyValue value={item} /> : String(item)}
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object" && value !== null) {
    return (
      <div className="space-y-2">
        {Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
          <div key={key}>
            <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{key.replace(/([A-Z])/g, " $1")}</div>
            <div className="mt-1"><FriendlyValue value={entry} /></div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm leading-6 text-charcoal-700">{String(value)}</div>;
}

function ResultViewer({ value }: { value: unknown }) {
  if (!value) return <div className="text-sm text-charcoal-400">No result yet.</div>;
  if (typeof value === "object") {
    const data = value as Record<string, unknown>;
    const articleHtml = typeof data.articleHtml === "string" ? data.articleHtml : null;
    const codeKeys = ["schemaJsonLd", "llmsTxt", "llmsSection", "markdown"];
    const hasCodeOutput = codeKeys.some((key) => typeof data[key] === "string" || typeof data[key] === "object");
    const visibleEntries = Object.entries(data).filter(([key]) => key !== "articleHtml" && !codeKeys.includes(key));
    return (
      <div className="space-y-4">
        {articleHtml && (
          <div className="rounded-lg border border-charcoal-100 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-charcoal-800">Article preview</div>
            <div className="prose prose-sm max-w-none text-charcoal-700" dangerouslySetInnerHTML={{ __html: articleHtml }} />
          </div>
        )}
        {hasCodeOutput && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <div className="text-sm font-semibold text-emerald-900">Generated content is ready</div>
            <div className="mt-1 text-sm text-emerald-800">Use Copy to copy the generated schema, llms.txt, or markdown output.</div>
          </div>
        )}
        {visibleEntries.length > 0 && (
          <div className="space-y-4">
            {visibleEntries.map(([key, entry]) => (
              <div key={key} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                <div className="mb-2 text-sm font-semibold capitalize text-charcoal-800">{key.replace(/([A-Z])/g, " $1")}</div>
                <FriendlyValue value={entry} />
              </div>
            ))}
          </div>
        )}
        {!articleHtml && !hasCodeOutput && visibleEntries.length === 0 && <div className="text-sm text-charcoal-400">Generated content is ready. Use Copy to copy it.</div>}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm text-charcoal-700">{String(value)}</div>;
}

function resultText(value: unknown) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function TabbedResultViewer({
  items,
  activeId,
  onActiveChange,
}: {
  items: AiContentGeneration[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (items.length === 0) return <ResultViewer value={null} />;
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const copyActive = async () => {
    await navigator.clipboard.writeText(resultText(active.resultJson));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-charcoal-100 bg-white">
      <div className="border-b border-charcoal-100 bg-charcoal-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-charcoal-800">Generated content</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Switch tabs to review each stored output.</div>
          </div>
          <Button variant="ghost" onClick={copyActive}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>
      <div className="border-b border-charcoal-100 bg-white px-4 pt-3">
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onActiveChange(item.id)}
              className={`rounded-t-lg border border-b-0 px-3 py-2 text-sm font-semibold ${active.id === item.id ? "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900" : "border-charcoal-100 bg-charcoal-50 text-charcoal-500 hover:text-charcoal-800"}`}
            >
              {prettyType(item.type)}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-charcoal-800">{prettyType(active.type)}</div>
          <div className="mt-0.5 text-xs text-charcoal-400">{active.topic} · {formatDate(active.createdAt)}</div>
        </div>
        <ResultViewer value={active.resultJson} />
      </div>
    </div>
  );
}

function WizardStep({ number, title, active, complete }: { number: number; title: string; active: boolean; complete: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-fuchsia-600 text-white" : complete ? "bg-emerald-100 text-emerald-700" : "bg-charcoal-100 text-charcoal-500"}`}>
        {number}
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-semibold ${active ? "text-charcoal-900" : "text-charcoal-500"}`}>{title}</div>
        <div className={`mt-1 h-1.5 rounded-full ${active ? "bg-fuchsia-500" : complete ? "bg-emerald-400" : "bg-charcoal-100"}`} />
      </div>
    </div>
  );
}

export default function AiContentStudio() {
  const [status, setStatus] = useState<AiContentStatus | null>(null);
  const [history, setHistory] = useState<AiContentGeneration[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [type, setType] = useState<AiGenerationType>("article");
  const [topic, setTopic] = useState("");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [languageCode, setLanguageCode] = useState("en");
  const [tone, setTone] = useState("professional");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedResult, setSelectedResult] = useState<AiContentGeneration | null>(null);
  const [selectedResultItems, setSelectedResultItems] = useState<AiContentGeneration[]>([]);
  const [selectedResultTabId, setSelectedResultTabId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [expandedHistoryGroup, setExpandedHistoryGroup] = useState<string | null>(null);

  const selectedType = useMemo(() => GENERATION_TYPES.find((item) => item.value === type)!, [type]);
  const articlePercent = status ? Math.min(100, Math.round((status.usage.articlesUsed / Math.max(1, status.usage.articleLimit)) * 100)) : 0;
  const helperPercent = status ? Math.min(100, Math.round((status.usage.helpersUsed / Math.max(1, status.usage.helperDailyLimit)) * 100)) : 0;
  const articlesRemaining = status ? Math.max(0, status.usage.articleLimit - status.usage.articlesUsed) : 0;
  const helpersRemaining = status ? Math.max(0, status.usage.helperDailyLimit - status.usage.helpersUsed) : 0;
  const currentMonthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date());
  const historyGroups = useMemo<GenerationGroup[]>(() => {
    const grouped = new Map<string, GenerationGroup>();
    for (const item of history) {
      const baseTopic = groupedTopic(item.topic);
      const key = [baseTopic.toLowerCase(), item.targetKeyword ?? "", item.targetUrl ?? ""].join("|");
      const existing = grouped.get(key);
      if (existing) {
        existing.items.push(item);
        existing.tokens += item.inputTokens + item.outputTokens;
        if (new Date(item.createdAt).getTime() > new Date(existing.createdAt).getTime()) existing.createdAt = item.createdAt;
      } else {
        grouped.set(key, {
          key,
          topic: baseTopic,
          keyword: item.targetKeyword,
          targetUrl: item.targetUrl,
          items: [item],
          tokens: item.inputTokens + item.outputTokens,
          createdAt: item.createdAt,
        });
      }
    }
    return [...grouped.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [history]);
  const canReview = topic.trim().length > 0;

  const load = async () => {
    setLoading(true);
    try {
      const [statusResult, historyResult, websiteResult] = await Promise.all([
        api.get<AiContentStatus>("/api/ai-content/status"),
        api.get<{ generations: AiContentGeneration[] }>("/api/ai-content/history"),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      setStatus(statusResult);
      setHistory(historyResult.generations);
      setWebsites(websiteResult.websites);
      if (!websiteId && websiteResult.websites[0]) setWebsiteId(websiteResult.websites[0].id);
      if (!selectedResult && historyResult.generations[0]) {
        setSelectedResult(historyResult.generations[0]);
        setSelectedResultItems([historyResult.generations[0]]);
        setSelectedResultTabId(historyResult.generations[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canReview) return;
    setGenerating(true);
    try {
      const result = await api.post<{ generation: AiContentGeneration }>("/api/ai-content/generate", {
        websiteId: websiteId || null,
        type,
        topic,
        targetKeyword: targetKeyword || null,
        targetUrl: targetUrl || null,
        languageCode,
        tone,
        notes: notes || null,
      });
      setSelectedResult(result.generation);
      setSelectedResultItems([result.generation]);
      setSelectedResultTabId(result.generation.id);
      setHistory((prev) => [result.generation, ...prev]);
      setWizardStep(3);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "AI generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-fuchsia-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_52%,#f0fdf4_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">AI Content Studio</div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-charcoal-900">Articles, SEO helpers, schema, llms.txt, and AI-search</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-600">
              Generate project-aware content assets using your plan quota. Articles count against the monthly article limit; helper tools are fair-use limited.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {status && (
              <div className="rounded-xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Current plan</div>
                <div className="mt-1 text-2xl font-bold text-fuchsia-700">{status.plan.name}</div>
                <div className="text-xs text-charcoal-500">${status.plan.priceMonthly}/month · {status.plan.subscriptionStatus}</div>
              </div>
            )}
            <Button onClick={() => { setWizardStep(1); setWizardOpen(true); }} className="shadow-sm">Create content asset</Button>
          </div>
        </div>
      </div>

      {status && (
        <div className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-charcoal-800">Monthly usage</div>
              <div className="text-xs text-charcoal-400">Current cycle: {currentMonthLabel}</div>
            </div>
            <div className="text-xs text-charcoal-500">Remaining counts update after each generation.</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="border-fuchsia-100 bg-fuchsia-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Articles this month</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-3xl font-bold text-fuchsia-700">{status.usage.articlesUsed}/{status.usage.articleLimit}</div>
                <div className="text-right">
                  <div className="text-lg font-bold text-charcoal-900">{articlesRemaining}</div>
                  <div className="text-xs text-charcoal-500">remaining</div>
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-fuchsia-500" style={{ width: `${articlePercent}%` }} />
              </div>
            </Card>
            <Card className="border-cyan-100 bg-cyan-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Helper generations this month</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-3xl font-bold text-cyan-700">{status.usage.helpersUsed}/{status.usage.helperDailyLimit}</div>
                <div className="text-right">
                  <div className="text-lg font-bold text-charcoal-900">{helpersRemaining}</div>
                  <div className="text-xs text-charcoal-500">remaining</div>
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-cyan-500" style={{ width: `${helperPercent}%` }} />
              </div>
            </Card>
            <Card className="border-emerald-100 bg-emerald-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Tokens this month</div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">{status.usage.tokens.toLocaleString()}</div>
              <div className="mt-1 text-xs text-charcoal-500">Tracked for cost control</div>
            </Card>
            <Card className="border-amber-100 bg-amber-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Available tools</div>
              <div className="mt-2 text-3xl font-bold text-amber-700">{GENERATION_TYPES.length}</div>
              <div className="mt-1 text-xs text-charcoal-500">Article, title, meta, FAQ, schema, llms.txt, AI-search</div>
            </Card>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-charcoal-100 bg-charcoal-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-charcoal-800">Content workflow</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Create new AI assets through a focused 3-step popup.</div>
          </div>
          <Button onClick={() => { setWizardStep(1); setWizardOpen(true); }}>Open 3-step wizard</Button>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-3">
          <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/70 p-4">
            <div className="text-sm font-semibold text-fuchsia-900">Step 1</div>
            <div className="mt-1 text-lg font-bold text-charcoal-900">Choose asset type</div>
            <p className="mt-1 text-sm text-charcoal-600">Pick article, titles, descriptions, FAQ, schema, llms.txt, or AI-search suggestions.</p>
          </div>
          <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-4">
            <div className="text-sm font-semibold text-cyan-900">Step 2</div>
            <div className="mt-1 text-lg font-bold text-charcoal-900">Add project context</div>
            <p className="mt-1 text-sm text-charcoal-600">Select a project and provide topic, keyword, URL, language, tone, and notes.</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="text-sm font-semibold text-emerald-900">Step 3</div>
            <div className="mt-1 text-lg font-bold text-charcoal-900">Generate and review</div>
            <p className="mt-1 text-sm text-charcoal-600">Confirm the request, generate the result, then review it inside the wizard.</p>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
          <div>
            <div className="font-semibold text-charcoal-800">Recent generations</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Latest AI outputs for this account.</div>
          </div>
          <Button variant="ghost" onClick={load}>Refresh</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Request</th>
                <th className="px-5 py-2">Outputs</th>
                <th className="px-5 py-2">Keyword</th>
                <th className="px-5 py-2">Target URL</th>
                <th className="px-5 py-2">Tokens</th>
                <th className="px-5 py-2">Created</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {historyGroups.map((group) => {
                const open = expandedHistoryGroup === group.key;
                const firstItem = group.items[0];
                return (
                  <Fragment key={group.key}>
                    <tr className="border-t border-charcoal-50 align-top">
                      <td className="max-w-[280px] px-5 py-3">
                        <div className="font-medium text-charcoal-800">{group.topic}</div>
                        <div className="mt-1 text-xs text-charcoal-400">{group.items.length} stored output{group.items.length === 1 ? "" : "s"}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {Object.entries(group.items.reduce<Record<string, number>>((acc, item) => {
                            acc[item.type] = (acc[item.type] ?? 0) + 1;
                            return acc;
                          }, {})).map(([itemType, count]) => (
                            <span key={itemType} className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-xs font-semibold text-fuchsia-700">
                              {prettyType(itemType)}{count > 1 ? ` x${count}` : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-charcoal-500">{group.keyword ?? "-"}</td>
                      <td className="max-w-[240px] truncate px-5 py-3 text-charcoal-500">{group.targetUrl ?? "-"}</td>
                      <td className="px-5 py-3 text-charcoal-500">{group.tokens}</td>
                      <td className="px-5 py-3 text-charcoal-500">{formatDate(group.createdAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setExpandedHistoryGroup(open ? null : group.key)}>{open ? "Hide" : "Details"}</Button>
                          <Button variant="ghost" onClick={() => { setSelectedResult(firstItem); setSelectedResultItems(group.items); setSelectedResultTabId(firstItem.id); setType(firstItem.type); setTopic(firstItem.topic); setTargetKeyword(firstItem.targetKeyword ?? ""); setTargetUrl(firstItem.targetUrl ?? ""); setWizardStep(3); setWizardOpen(true); }}>View</Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-charcoal-50 bg-charcoal-50/50">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="overflow-hidden rounded-lg border border-charcoal-100 bg-white">
                            <table className="w-full text-sm">
                              <thead className="bg-white text-left text-xs uppercase text-charcoal-400">
                                <tr>
                                  <th className="px-4 py-2">Output</th>
                                  <th className="px-4 py-2">Topic</th>
                                  <th className="px-4 py-2">Tokens</th>
                                  <th className="px-4 py-2">Created</th>
                                  <th className="px-4 py-2 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((item) => (
                                  <tr key={item.id} className="border-t border-charcoal-50">
                                    <td className="px-4 py-2 font-medium text-charcoal-800">{prettyType(item.type)}</td>
                                    <td className="max-w-[360px] truncate px-4 py-2 text-charcoal-600">{item.topic}</td>
                                    <td className="px-4 py-2 text-charcoal-500">{item.inputTokens + item.outputTokens}</td>
                                    <td className="px-4 py-2 text-charcoal-500">{formatDate(item.createdAt)}</td>
                                    <td className="px-4 py-2 text-right"><Button variant="ghost" onClick={() => { setSelectedResult(item); setSelectedResultItems(group.items); setSelectedResultTabId(item.id); setType(item.type); setTopic(item.topic); setTargetKeyword(item.targetKeyword ?? ""); setTargetUrl(item.targetUrl ?? ""); setWizardStep(3); setWizardOpen(true); }}>View</Button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {historyGroups.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-charcoal-400">No AI generations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {wizardOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Create AI content asset">
          <div className="absolute inset-0 bg-charcoal-900/55" onClick={() => !generating && setWizardOpen(false)} />
          <div className="absolute inset-x-3 top-4 mx-auto flex max-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:top-8 sm:max-h-[calc(100vh-4rem)]">
            <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_100%)] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">3-step wizard</div>
                  <div className="mt-1 text-xl font-bold text-charcoal-900">Create content asset</div>
                </div>
                <button type="button" disabled={generating} onClick={() => setWizardOpen(false)} className="rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 disabled:opacity-50">Close</button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <WizardStep number={1} title="Choose type" active={wizardStep === 1} complete={wizardStep > 1} />
                <WizardStep number={2} title="Add context" active={wizardStep === 2} complete={wizardStep > 2} />
                <WizardStep number={3} title="Review" active={wizardStep === 3} complete={false} />
              </div>
            </div>

            <form onSubmit={generate} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {wizardStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-bold text-charcoal-900">Choose what you want to create</h2>
                      <p className="mt-1 text-sm text-charcoal-500">Select one AI tool. You can change this before generating.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {GENERATION_TYPES.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setType(item.value)}
                          className={`rounded-xl border p-4 text-left transition ${type === item.value ? "border-fuchsia-300 bg-fuchsia-50 shadow-sm" : "border-charcoal-100 bg-white hover:border-fuchsia-200 hover:bg-fuchsia-50/40"}`}
                        >
                          <div className="font-semibold text-charcoal-900">{item.label}</div>
                          <div className="mt-2 text-sm leading-5 text-charcoal-500">{item.detail}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="text-lg font-bold text-charcoal-900">Add project and page context</h2>
                      <p className="mt-1 text-sm text-charcoal-500">The more context you add, the better the generated output will match the page and domain.</p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
                        <select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">No project context</option>
                          {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
                        </select>
                      </label>
                      <div className="lg:col-span-2"><Input label="Topic" value={topic} onChange={setTopic} placeholder="CRM automation for service businesses" /></div>
                      <Input label="Target keyword" value={targetKeyword} onChange={setTargetKeyword} placeholder="crm automation" />
                      <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-page" />
                      <Input label="Language" value={languageCode} onChange={setLanguageCode} placeholder="en" />
                      <Input label="Tone" value={tone} onChange={setTone} placeholder="professional" />
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Extra notes</span>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="Audience, offer, location, services, internal notes..." />
                      </label>
                    </div>
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-charcoal-100 bg-charcoal-50 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-bold text-charcoal-900">Review and generate</div>
                        <div className="text-xs text-charcoal-500">
                          {status ? (type === "article"
                            ? `${status.usage.articlesUsed}/${status.usage.articleLimit} used · ${articlesRemaining} remaining`
                            : `${status.usage.helpersUsed}/${status.usage.helperDailyLimit} used · ${helpersRemaining} remaining`) : "Loading quota..."}
                        </div>
                      </div>
                      <div className="grid gap-2 text-xs text-charcoal-600 lg:grid-cols-[0.8fr_1.4fr_1fr_0.8fr]">
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Type:</span> {selectedType.label}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Topic:</span> {topic || "Missing topic"}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Project:</span> {websites.find((website) => website.id === websiteId)?.domain ?? "No project context"}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Tone:</span> {languageCode || "en"} · {tone || "professional"}</div>
                      </div>
                      <div className="mt-1 truncate text-xs text-charcoal-500">Keyword: {targetKeyword || "Not provided"} · URL: {targetUrl || "Not provided"}</div>
                    </div>

                    <TabbedResultViewer
                      items={selectedResultItems.length > 0 ? selectedResultItems : selectedResult ? [selectedResult] : []}
                      activeId={selectedResultTabId}
                      onActiveChange={setSelectedResultTabId}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="ghost" disabled={wizardStep === 1 || generating} onClick={() => setWizardStep((step) => Math.max(1, step - 1))}>Back</Button>
                <div className="flex gap-3 sm:justify-end">
                  {wizardStep < 3 ? (
                    <Button type="button" onClick={() => setWizardStep((step) => Math.min(3, step + 1))} disabled={wizardStep === 2 && !canReview}>Next</Button>
                  ) : (
                    <Button type="submit" disabled={generating || !canReview}>{generating ? "Generating..." : "Generate"}</Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
