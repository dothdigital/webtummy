import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

type PublisherPage = {
  id: string;
  title: string;
  slug: string;
  pageType: string;
  primaryKeyword: string;
  status: string;
};

export type WordPressPublishingJob = {
  id: string;
  targetType: string;
  actionType: string;
  targetPostType: string;
  targetPageId: string | null;
  publishMode: string;
  title: string | null;
  slug: string | null;
  requestJson: unknown;
  mediaJson: unknown;
  internalLinksJson: unknown;
  previewJson: unknown;
  validationJson: unknown;
  approvalStatus: string;
  releaseId: string | null;
  externalPostId: string | null;
  remoteUrl: string | null;
  status: string;
  errorMessage: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

type Integration = {
  id: string;
  siteUrl: string;
  connectionStatus: string;
};

type PublisherForm = {
  actionType: "create_content" | "update_content" | "add_image" | "add_faq" | "update_schema" | "update_internal_links" | "update_metadata";
  targetType: "blog_post" | "service_page" | "location_page" | "landing_page" | "case_study" | "portfolio" | "team_profile" | "testimonial" | "page_update";
  targetPageId: string;
  title: string;
  slug: string;
  primaryKeyword: string;
  location: string;
  instructions: string;
  generateImage: boolean;
  imagePlacement: "hero" | "banner" | "inline";
};

const blankForm = (): PublisherForm => ({
  actionType: "create_content",
  targetType: "blog_post",
  targetPageId: "",
  title: "",
  slug: "",
  primaryKeyword: "",
  location: "",
  instructions: "",
  generateImage: true,
  imagePlacement: "hero",
});

const actionOptions: Array<{ value: PublisherForm["actionType"]; label: string; detail: string }> = [
  { value: "create_content", label: "Create new content", detail: "Blog, service, city, landing, trust, or profile page" },
  { value: "update_content", label: "Rewrite an existing page", detail: "Create a new reviewed version without overwriting the live page" },
  { value: "add_image", label: "Add or replace an image", detail: "Generate a relevant hero, banner, or inline image" },
  { value: "add_faq", label: "Add FAQs", detail: "Generate page-specific questions, answers, and FAQ schema" },
  { value: "update_internal_links", label: "Improve internal links", detail: "Select useful approved destinations and natural anchor text" },
  { value: "update_metadata", label: "Improve SEO metadata", detail: "Rewrite the title and meta description for the assigned intent" },
  { value: "update_schema", label: "Refresh schema", detail: "Rebuild schema from approved business, service, location, and FAQ facts" },
];

const contentTypes: Array<{ value: PublisherForm["targetType"]; label: string }> = [
  { value: "blog_post", label: "Blog post" },
  { value: "service_page", label: "Service page" },
  { value: "location_page", label: "City / location page" },
  { value: "landing_page", label: "Landing page" },
  { value: "case_study", label: "Case study" },
  { value: "portfolio", label: "Portfolio item" },
  { value: "team_profile", label: "Team / profile page" },
  { value: "testimonial", label: "Testimonial page" },
];

const jobStatus: Record<string, { label: string; colour: string; step: number }> = {
  requested: { label: "Ready for AI", colour: "bg-sky-100 text-sky-800", step: 1 },
  generating: { label: "AI generating", colour: "bg-violet-100 text-violet-800", step: 2 },
  generating_image: { label: "AI creating image", colour: "bg-violet-100 text-violet-800", step: 2 },
  needs_review: { label: "Ready to review", colour: "bg-amber-100 text-amber-800", step: 3 },
  approval_blocked: { label: "Approval fixes required", colour: "bg-rose-100 text-rose-800", step: 4 },
  needs_revision: { label: "Revision requested", colour: "bg-orange-100 text-orange-800", step: 2 },
  approved: { label: "Approved", colour: "bg-emerald-100 text-emerald-800", step: 4 },
  draft_ready: { label: "WordPress draft ready", colour: "bg-indigo-100 text-indigo-800", step: 5 },
  published: { label: "Published & verified", colour: "bg-emerald-700 text-white", step: 6 },
  needs_attention: { label: "Needs attention", colour: "bg-rose-100 text-rose-800", step: 2 },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default function WordPressPublishingEngine({
  projectId,
  jobs,
  pages,
  integration,
  onChanged,
}: {
  projectId: string;
  jobs: WordPressPublishingJob[];
  pages: PublisherPage[];
  integration: Integration | null;
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PublisherForm>(blankForm);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [revisionJob, setRevisionJob] = useState<WordPressPublishingJob | null>(null);
  const [revision, setRevision] = useState("");
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [jobs]);
  const createMode = form.actionType === "create_content";
  const imageAction = form.actionType === "add_image";
  useEffect(() => {
    if (!jobs.some(job => ["generating", "generating_image"].includes(job.status))) return;
    const timer = window.setInterval(() => void onChanged(), 4000);
    return () => window.clearInterval(timer);
  }, [jobs.map(job => `${job.id}:${job.status}`).join("|"), onChanged]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setMessage("");
    try {
      await action();
      await onChanged();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The publishing request could not be completed.");
    } finally {
      setBusy("");
    }
  };

  const createAndGenerate = async () => {
    setBusy("create");
    setMessage("");
    try {
      const created = await api.post<{ job: WordPressPublishingJob }>(
        `/api/projects/${projectId}/website-builder/wordpress-publisher/requests`,
        {
          ...form,
          integrationId: integration?.id ?? null,
          targetPageId: createMode ? null : form.targetPageId || null,
          targetType: createMode ? form.targetType : "page_update",
          title: createMode ? form.title : pages.find((page) => page.id === form.targetPageId)?.title || form.title,
          primaryKeyword: createMode ? form.primaryKeyword : pages.find((page) => page.id === form.targetPageId)?.primaryKeyword || form.primaryKeyword,
          generateImage: imageAction || createMode ? form.generateImage : false,
          publishMode: "draft",
        },
      );
      setOpen(false);
      setForm(blankForm());
      await onChanged();
      setBusy(`generate-${created.job.id}`);
      await api.post(`/api/projects/${projectId}/website-builder/wordpress-publisher/requests/${created.job.id}/generate`, {});
      await onChanged();
      setMessage("AI created the requested content and preview. Review the exact version before approval.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The publishing request could not be generated.");
      await onChanged();
    } finally {
      setBusy("");
    }
  };

  const preview = (job: WordPressPublishingJob, editor = false) => {
    if (!job.targetPageId) return;
    const url = `/site-architect/${editor ? "visual-editor" : "preview"}?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(job.targetPageId)}`;
    const next = window.open(url, "_blank");
    if (next) next.opener = null;
    else setMessage("Allow popups for SEnuke AI - AI Growth Operating System to open the website preview.");
  };

  const deploy = (job: WordPressPublishingJob, mode: "draft" | "publish") => {
    if (!integration || !job.targetPageId) return;
    if (mode === "publish" && !window.confirm(`Publish “${job.title}” live to ${integration.siteUrl}?`)) return;
    void run(
      `${mode}-${job.id}`,
      () => api.post(`/api/projects/${projectId}/website-builder/deploy`, {
        integrationId: integration.id,
        mode,
        confirmed: mode === "publish",
        pageIds: [job.targetPageId],
        publishingJobId: job.id,
        deployDesignPackage: false,
      }),
      mode === "draft"
        ? "WordPress draft created and verified. Review the WordPress URL before publishing live."
        : "The approved content was published and its live URL was verified.",
    );
  };

  return <section className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-indigo-50 p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Ongoing WordPress publishing</div>
        <h3 className="mt-1 text-xl font-black text-slate-950">Create, update, approve, and publish after website launch</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">Every request becomes a new Website Model version. AI prepares the content, image, metadata, schema, and internal links; a reviewer approves the exact preview before WordPress receives it.</p>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-cyan-700 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-200">New publishing request</button>
    </div>

    <div className="mt-5 grid gap-2 sm:grid-cols-6">
      {["Request", "AI content + image", "Preview", "Approve", "WordPress draft", "Publish + verify"].map((label, index) => <div key={label} className="relative rounded-xl border border-white bg-white/80 p-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-900 text-[10px] font-black text-white">{index + 1}</span>
        <b className="mt-2 block text-[11px] text-slate-800">{label}</b>
      </div>)}
    </div>

    {!integration && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Connect WordPress to create drafts or publish. AI generation, preview, and approval remain available before the connection is added.</div>}
    {message && <div className={`mt-4 rounded-xl border p-3 text-xs font-semibold ${/failed|could not|attention|error|resolve/i.test(message) ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>}

    <div className="mt-5 space-y-3">
      {sortedJobs.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-center"><b className="text-sm text-slate-800">No post-launch publishing requests yet</b><p className="mt-1 text-xs text-slate-500">Create a blog, city page, service update, image, FAQ, schema, internal-link, or metadata request.</p></div> : sortedJobs.slice(0, 20).map(job => {
        const status = jobStatus[job.status] ?? { label: job.status.replaceAll("_", " "), colour: "bg-slate-100 text-slate-700", step: 1 };
        const quality = record(record(job.validationJson).quality);
        const internalLinkCount = Array.isArray(job.internalLinksJson) ? job.internalLinksJson.length : 0;
        const media = record(job.mediaJson);
        return <article key={job.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${status.colour}`}>{status.label}</span><span className="text-[10px] font-bold uppercase text-slate-400">{job.targetType.replaceAll("_", " ")} · Version {job.version}</span></div>
              <b className="mt-2 block text-sm text-slate-950">{job.title || "Untitled publishing request"}</b>
              <p className="mt-1 text-xs text-slate-500">{job.actionType.replaceAll("_", " ")}{job.slug ? ` · /${job.slug}` : ""}{quality.score ? ` · SEO ${String(quality.score)}/100` : ""}{internalLinkCount ? ` · ${internalLinkCount} internal links` : ""}{media.assetId ? " · image ready" : ""}</p>
              {job.errorMessage && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{job.errorMessage}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {["requested", "needs_revision", "needs_attention"].includes(job.status) && <button disabled={Boolean(busy)} onClick={() => void run(`generate-${job.id}`, () => api.post(`/api/projects/${projectId}/website-builder/wordpress-publisher/requests/${job.id}/generate`, {}), "AI prepared a new version for review.")} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{busy === `generate-${job.id}` ? "Generating…" : job.status === "requested" ? "Generate with AI" : "Retry generation"}</button>}
              {job.targetPageId && ["needs_review", "approval_blocked", "approved", "draft_ready", "published"].includes(job.status) && <button onClick={() => preview(job)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800">Preview ↗</button>}
              {["needs_review", "approval_blocked"].includes(job.status) && <button onClick={() => preview(job, true)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">Edit</button>}
              {["needs_review", "approval_blocked"].includes(job.status) && <button onClick={() => { setRevisionJob(job); setRevision(""); }} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">Request changes</button>}
              {["needs_review", "approval_blocked"].includes(job.status) && <button disabled={Boolean(busy)} onClick={() => void run(`approve-${job.id}`, () => api.post(`/api/projects/${projectId}/website-builder/wordpress-publisher/requests/${job.id}/approve`, {}), "The exact Website Model version is approved and ready for a WordPress draft.")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{job.status === "approval_blocked" ? "Recheck & Approve" : "Approve"}</button>}
              {job.status === "approved" && <button disabled={!integration || Boolean(busy)} onClick={() => deploy(job, "draft")} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Create WordPress Draft</button>}
              {job.status === "draft_ready" && job.remoteUrl && <a href={job.remoteUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800">Review WordPress ↗</a>}
              {job.status === "draft_ready" && <button disabled={!integration || Boolean(busy)} onClick={() => deploy(job, "publish")} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Publish Live</button>}
              {job.status === "published" && job.remoteUrl && <a href={job.remoteUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white">View Live ↗</a>}
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-600" style={{ width: `${Math.round(status.step / 6 * 100)}%` }} /></div>
        </article>;
      })}
    </div>

    {open && <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" aria-label="Close publishing request" onClick={() => setOpen(false)} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b bg-gradient-to-r from-cyan-50 via-white to-indigo-50 px-6 py-5"><div><div className="text-xs font-black uppercase tracking-wide text-cyan-700">WordPress publishing engine</div><h2 className="mt-1 text-xl font-black text-slate-950">What should SENuke create or update?</h2><p className="mt-1 text-sm text-slate-500">AI prepares a reviewable draft. Nothing is sent to WordPress until approval.</p></div><button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg border bg-white text-lg text-slate-500">×</button></div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-2 md:grid-cols-2">{actionOptions.map(option => <button type="button" key={option.value} onClick={() => setForm(current => ({ ...current, actionType: option.value, targetType: option.value === "create_content" ? current.targetType : "page_update", generateImage: option.value === "create_content" || option.value === "add_image" }))} className={`rounded-xl border p-3 text-left ${form.actionType === option.value ? "border-cyan-400 bg-cyan-50 ring-2 ring-cyan-100" : "border-slate-200"}`}><b className="text-sm text-slate-900">{option.label}</b><p className="mt-1 text-xs leading-5 text-slate-500">{option.detail}</p></button>)}</div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {createMode ? <label className="text-xs font-black text-slate-700">Content type<select value={form.targetType} onChange={event => setForm({ ...form, targetType: event.target.value as PublisherForm["targetType"] })} className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm font-normal">{contentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label> : <label className="text-xs font-black text-slate-700">Website page to update<select value={form.targetPageId} onChange={event => { const selected = pages.find(page => page.id === event.target.value); setForm({ ...form, targetPageId: event.target.value, title: selected?.title || "", primaryKeyword: selected?.primaryKeyword || "" }); }} className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm font-normal"><option value="">Select a page</option>{pages.map(page => <option key={page.id} value={page.id}>{page.title} · /{page.slug}</option>)}</select></label>}
            {createMode && <label className="text-xs font-black text-slate-700">Title<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value, slug: form.slug || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm font-normal" placeholder="How Much Does Super Visa Insurance Cost in Ontario?" /></label>}
            {createMode && <label className="text-xs font-black text-slate-700">Primary keyword<input value={form.primaryKeyword} onChange={event => setForm({ ...form, primaryKeyword: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm font-normal" placeholder="super visa insurance cost Ontario" /></label>}
            {createMode && <label className="text-xs font-black text-slate-700">URL slug<input value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm font-normal" placeholder="super-visa-insurance-cost-ontario" /></label>}
            <label className="text-xs font-black text-slate-700">Location, when relevant<input value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm font-normal" placeholder="Hamilton, Ontario" /></label>
            <label className="text-xs font-black text-slate-700 md:col-span-2">Instructions<textarea rows={5} value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm font-normal leading-6" placeholder="Explain the buyer question, approved facts, desired CTA, tone, and anything SENuke should preserve or change." /></label>
            {(createMode || imageAction) && <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 md:col-span-2"><label className="flex items-center gap-2 text-sm font-black text-indigo-950"><input type="checkbox" checked={form.generateImage} onChange={event => setForm({ ...form, generateImage: event.target.checked })} /> Generate a relevant page image with AI</label>{form.generateImage && <label className="mt-3 block text-xs font-black text-indigo-800">Placement<select value={form.imagePlacement} onChange={event => setForm({ ...form, imagePlacement: event.target.value as PublisherForm["imagePlacement"] })} className="mt-1.5 w-full rounded-lg border border-indigo-200 bg-white p-2.5 text-sm font-normal"><option value="hero">Hero image</option><option value="banner">Full-width banner</option><option value="inline">Inline content image</option></select></label>}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-6 py-4"><p className="max-w-2xl text-xs text-slate-500">The current live WordPress version remains unchanged through generation, editing, and approval.</p><div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border bg-white px-4 py-2.5 text-sm font-bold">Cancel</button><button type="button" disabled={busy === "create" || form.instructions.trim().length < 3 || (createMode ? form.title.trim().length < 2 || form.primaryKeyword.trim().length < 2 : !form.targetPageId)} onClick={() => void createAndGenerate()} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy === "create" ? "AI is preparing the draft…" : "Create Request & Generate"}</button></div></div>
      </div>
    </div>}

    {revisionJob && <div className="fixed inset-0 z-[125] grid place-items-center bg-slate-950/65 p-4" role="dialog" aria-modal="true"><button type="button" className="absolute inset-0" onClick={() => setRevisionJob(null)} aria-label="Close revision" /><div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="border-b px-6 py-5"><div className="text-xs font-black uppercase text-amber-700">Request a new AI version</div><h2 className="mt-1 text-xl font-black">{revisionJob.title}</h2></div><div className="p-6"><label className="text-xs font-black text-slate-700">What should AI change?<textarea rows={6} value={revision} onChange={event => setRevision(event.target.value)} className="mt-1.5 w-full rounded-lg border p-3 text-sm leading-6" placeholder="Example: Make the introduction more direct, add Ontario-specific cost factors, and improve the CTA without inventing prices." /></label></div><div className="flex justify-end gap-2 border-t bg-slate-50 px-6 py-4"><button type="button" onClick={() => setRevisionJob(null)} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold">Cancel</button><button type="button" disabled={revision.trim().length < 3 || Boolean(busy)} onClick={() => void run(`revise-${revisionJob.id}`, async () => { await api.post(`/api/projects/${projectId}/website-builder/wordpress-publisher/requests/${revisionJob.id}/revise`, { instructions: revision }); await api.post(`/api/projects/${projectId}/website-builder/wordpress-publisher/requests/${revisionJob.id}/generate`, {}); setRevisionJob(null); }, "AI created a revised version for review.")} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">Regenerate Version</button></div></div></div>}
  </section>;
}
