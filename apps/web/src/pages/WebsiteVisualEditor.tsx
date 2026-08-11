import { useEffect, useMemo, useState } from "react";
import { ActionBar, Puck, Render, legacySideBarPlugin, type Data } from "@puckeditor/core";
import { flattenWebsiteComponents, type WebsiteComponentInstance } from "@webtummy/core/website-model";
import { api } from "../api.js";
import {
  createSenukePuckConfig,
  puckToWebsiteComponents,
  themeVariables,
  websiteComponentsToPuck,
} from "../website-builder/puckAdapter.js";

type Page = {
  id: string;
  title: string;
  slug: string;
  pageType: string;
  status: string;
  version: number;
  contentJson: unknown;
  visualComponents?: WebsiteComponentInstance[];
  mediaAssets: Array<{ id: string; role: string; status: string; sourceUrl: string | null; sourceAvailable?: boolean; altText: string | null }>;
};
type Build = { id: string; name: string; brandJson: unknown; settingsJson: unknown; pages: Page[] };
type Response = { project: { id: string; name: string; businessName: string | null }; build: Build | null; websiteWorkflow: { model: { version: number } | null } };
type PuckRecord = Record<string, Record<string, unknown>>;
type ViewMode = "desktop" | "tablet" | "mobile";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const componentsFromPage = (page: Page | null) => {
  const value = page?.visualComponents?.length ? page.visualComponents : object(page?.contentJson).components;
  let components = Array.isArray(value) ? value.filter((item): item is WebsiteComponentInstance => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const primaryHeroAsset = page?.mediaAssets.find((asset) => asset.id === `${page.id}-hero` && asset.role !== "none" && Boolean(asset.sourceUrl))
    ?? page?.mediaAssets.find((asset) => asset.role === "hero" && Boolean(asset.sourceUrl));
  const currentHeroAssetId = String(components.find((component) => component.componentId === "hero.local_service")?.props.imageAssetId || "").trim();
  const hasCanonicalHeroImage = Boolean(primaryHeroAsset && currentHeroAssetId === primaryHeroAsset.id);
  if (primaryHeroAsset && !hasCanonicalHeroImage) {
    components = components
      .filter((component) => !(component.componentId === "media.image" && component.props.imageAssetId === primaryHeroAsset.id))
      .map((component) => component.componentId === "hero.local_service"
        ? { ...component, variant: "split", props: { ...component.props, imageAssetId: primaryHeroAsset.id } }
        : component);
  }
  const isContactPage = page && (page.pageType === "conversion" || page.pageType === "contact" || /\bcontact(?:\s+us)?\b/i.test(page.title));
  if (!isContactPage || flattenWebsiteComponents(components).some((component) => component.componentId === "conversion.contact_form")) return components;
  const contactForm: WebsiteComponentInstance = {
    instanceId: `${page.id}-contact-form`,
    componentId: "conversion.contact_form",
    componentVersion: "1.0.0",
    variant: "split",
    props: {
      heading: "Tell us how we can help",
      introduction: "Send your question and the team will follow up using the verified contact details shown on this website.",
      formId: "primary-contact",
      fields: [
        { label: "Name", name: "name", inputType: "text", required: true },
        { label: "Email", name: "email", inputType: "email", required: true },
        { label: "Phone", name: "phone", inputType: "tel", required: false },
        { label: "How can we help?", name: "message", inputType: "textarea", required: true },
        { label: "I agree to be contacted about this enquiry.", name: "consent", inputType: "checkbox", required: true },
      ],
      submitLabel: "Send enquiry",
      successMessage: "Thank you. Your enquiry has been received and the team will follow up.",
    },
  };
  const ctaIndex = components.findIndex((component) => component.componentId === "conversion.cta");
  if (ctaIndex < 0) return [...components, contactForm];
  return [...components.slice(0, ctaIndex), contactForm, ...components.slice(ctaIndex)];
};
const viewportWidth: Record<ViewMode, number | "100%"> = { desktop: "100%", tablet: 820, mobile: 390 };

export default function WebsiteVisualEditor({ mode }: { mode: "editor" | "preview" }) {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("projectId") ?? "";
  const requestedPageId = params.get("pageId") ?? "";
  const embedded = params.get("embedded") === "1";
  const [response, setResponse] = useState<Response | null>(null);
  const [pageId, setPageId] = useState(requestedPageId);
  const [pageDetails, setPageDetails] = useState<Record<string, Page>>({});
  const [draft, setDraft] = useState<Data<PuckRecord> | null>(null);
  const [view, setView] = useState<ViewMode>("desktop");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [loadingPageId, setLoadingPageId] = useState("");
  const closeWorkspace = () => {
    if (embedded && window.parent !== window) {
      window.parent.postMessage({ type: "senuke:close-workspace-modal" }, window.location.origin);
      return;
    }
    if (window.history.length > 1) window.history.back();
    else window.location.assign(`/site-architect?projectId=${encodeURIComponent(projectId)}`);
  };
  const openPreview = () => {
    const preview = window.open(`/site-architect/preview?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(page?.id ?? pageId)}`, "_blank");
    if (preview) preview.opener = null;
    else setMessage("Your browser blocked the website preview tab. Allow popups for this site and try again.");
  };

  const load = async () => {
    if (!projectId) throw new Error("A project is required.");
    const result = await api.get<Response>(`/api/projects/${projectId}/website-builder`);
    setResponse(result);
    setPageDetails({});
    setDraft(null);
    const activePages = result.build?.pages.filter((page) => page.status !== "deferred") ?? [];
    const selected = activePages.find((page) => page.id === (pageId || requestedPageId)) ?? activePages[0] ?? null;
    if (selected) setPageId(selected.id);
  };

  useEffect(() => {
    setMessage("");
    setLoadingSlow(false);
    const slowTimer = window.setTimeout(() => setLoadingSlow(true), 7000);
    void load()
      .then(() => {
        window.clearTimeout(slowTimer);
        if (embedded && window.parent !== window) window.parent.postMessage({ type: "senuke:workspace-ready" }, window.location.origin);
      })
      .catch((error) => {
        window.clearTimeout(slowTimer);
        setMessage(error instanceof Error ? error.message : "The website model could not be loaded.");
      });
    return () => window.clearTimeout(slowTimer);
  }, [loadAttempt, projectId]);
  const build = response?.build ?? null;
  const activePages = build?.pages.filter((item) => item.status !== "deferred") ?? [];
  const pageSummary = activePages.find((item) => item.id === pageId) ?? activePages[0] ?? null;
  const page = pageSummary && pageDetails[pageSummary.id]?.version === pageSummary.version ? pageDetails[pageSummary.id] : pageSummary;
  const pageDetailReady = Boolean(pageSummary && pageDetails[pageSummary.id]?.version === pageSummary.version);
  const brand = object(build?.brandJson);
  const settings = object(build?.settingsJson);
  const themeInput = {
    primary: String(brand.primaryColor || "#2563eb"),
    secondary: String(brand.secondaryColor || "#0f766e"),
    accent: String(brand.accentColor || "#f59e0b"),
    background: String(brand.backgroundColor || "#f8fafc"),
    text: String(brand.textColor || "#0f172a"),
    mutedText: String(brand.mutedTextColor || "#475569"),
    headingFont: String(brand.headingFont || "Inter"),
    bodyFont: String(brand.bodyFont || "Inter"),
    radius: String(brand.radius || "14px"),
  };
  const mediaSignature = page?.mediaAssets.map((asset) => {
    const source = asset.sourceUrl ?? "";
    return `${asset.id}:${source.length}:${source.slice(-24)}:${asset.altText || ""}`;
  }).join("|") ?? "";
  const savedMenu = Array.isArray(settings.menu) ? settings.menu.map(object) : [];
  const websiteMenu = (savedMenu.length ? savedMenu : activePages.map((item) => ({ pageId: item.id, label: item.title, slug: item.slug, parentPageId: null, custom: false }))).map((item) => {
    const linkedPage = activePages.find((candidate) => candidate.id === String(item.pageId ?? ""));
    return {
      pageId: String(item.pageId ?? linkedPage?.id ?? ""),
      label: String(item.label ?? linkedPage?.title ?? "Page"),
      slug: String(item.slug ?? linkedPage?.slug ?? ""),
      parentPageId: item.parentPageId ? String(item.parentPageId) : null,
      custom: item.custom === true || String(item.pageId ?? "").startsWith("custom-"),
    };
  }).filter((item) => item.custom || activePages.some((candidate) => candidate.id === item.pageId));
  const savedFooterMenu = Array.isArray(settings.footerMenu) ? settings.footerMenu.map(object) : [];
  const rawFooterMenu = savedFooterMenu.map((item) => {
    const linkedPage = activePages.find((candidate) => candidate.id === String(item.pageId ?? ""));
    return { pageId: String(item.pageId ?? linkedPage?.id ?? ""), label: String(item.label ?? linkedPage?.title ?? "Page"), slug: String(item.slug ?? linkedPage?.slug ?? ""), parentPageId: item.parentPageId ? String(item.parentPageId) : null, custom: item.custom === true || String(item.pageId ?? "").startsWith("custom-") };
  }).filter((item) => item.custom || activePages.some((candidate) => candidate.id === item.pageId));
  const footerColumns = rawFooterMenu.filter((item) => item.custom && !item.parentPageId).slice(0, 2);
  const footerFallbacks = [{ pageId: "custom-footer-explore", label: "Explore", slug: "", parentPageId: null, custom: true }, { pageId: "custom-footer-information", label: "Information", slug: "", parentPageId: null, custom: true }];
  for (const fallback of footerFallbacks) if (footerColumns.length < 2) footerColumns.push(fallback);
  const footerColumnIds = new Set(footerColumns.map((item) => item.pageId));
  const footerWebsiteMenu = [...footerColumns, ...rawFooterMenu.filter((item) => !item.custom).map((item, index) => ({ ...item, parentPageId: item.parentPageId && footerColumnIds.has(item.parentPageId) ? item.parentPageId : footerColumns[index % 2].pageId }))];
  const chromeSignature = [...websiteMenu, ...footerWebsiteMenu].map((item) => `${item.pageId}:${item.parentPageId || ""}:${item.label}:${item.slug}:${item.custom ? 1 : 0}`).join("|");
  const logoUrl = String(brand.logoDataUrl || brand.logoUrl || "");
  const businessName = String(brand.businessName || response?.project.businessName || response?.project.name || build?.name.replace(/\s+website$/i, "") || "Website");
  const contactDetails = object(settings.contactDetails);
  const contactEmail = String(contactDetails.email || "");
  const contactPhone = String(contactDetails.phone || "");
  const businessAddress = String(contactDetails.address || "");
  const copyrightText = String(contactDetails.copyrightText || `© ${new Date().getFullYear()} ${businessName}. All rights reserved.`);
  const analysis = object(settings.analysis);
  const footerAboutText = String(settings.footerAboutText || contactDetails.businessSummary || analysis.businessSummary || `Learn more about ${businessName}.`).slice(0, 50);
  const socialLinks = object(contactDetails.socialLinks);
  const socialProfiles = (["facebook", "instagram", "linkedin", "youtube", "x", "tiktok"] as const).flatMap((network) => {
    const url = String(socialLinks[network] || "").trim();
    return /^https:\/\//i.test(url) ? [{ network, url }] : [];
  });
  const socialSignature = socialProfiles.map((profile) => `${profile.network}:${profile.url}`).join("|");
  const config = useMemo(() => createSenukePuckConfig(themeInput, page?.mediaAssets ?? [], { businessName, previewMode: view, logoUrl, contactEmail, contactPhone, businessAddress, copyrightText, footerAboutText, socialProfiles, menu: websiteMenu, footerMenu: footerWebsiteMenu, onNavigate: setPageId }), [themeInput.primary, themeInput.secondary, themeInput.accent, themeInput.background, themeInput.text, themeInput.mutedText, themeInput.headingFont, themeInput.bodyFont, themeInput.radius, mediaSignature, chromeSignature, logoUrl, businessName, contactEmail, contactPhone, businessAddress, copyrightText, footerAboutText, socialSignature, view]);
  const theme = themeVariables(themeInput);

  useEffect(() => {
    if (!projectId || !pageSummary) return;
    const selectedPageId = pageSummary.id;
    let cancelled = false;
    setLoadingPageId(selectedPageId);
    setDraft(null);
    setMessage("");
    void api.get<{ page: Page }>(`/api/projects/${projectId}/website-builder/pages/${selectedPageId}`)
      .then((result) => {
        if (cancelled) return;
        setPageDetails((current) => ({ ...current, [selectedPageId]: result.page }));
        setDraft(websiteComponentsToPuck(componentsFromPage(result.page)) as Data<PuckRecord>);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "The selected page content could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoadingPageId("");
      });
    return () => { cancelled = true; };
  }, [projectId, pageSummary?.id, pageSummary?.version, loadAttempt]);

  const save = async () => {
    if (!draft || !page) return;
    setSaving(true);
    setMessage("");
    try {
      const components = puckToWebsiteComponents(draft);
      const result = await api.put<{ page: Page; model: { version: number } }>(`/api/projects/${projectId}/website-builder/pages/${page.id}/visual-model`, {
        components,
        editorMetadata: { adapterVersion: "senuke-puck-1.0.0", viewport: view },
      });
      setMessage(`Saved as page version ${result.page.version} and Website Model version ${result.model.version}. Quality approval must run again.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The visual changes could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (!response) return <div className="grid min-h-screen place-items-center bg-slate-950 p-8 text-white"><div className="max-w-md text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-white/20 border-t-white"/><p className="mt-4 text-sm font-black">{message || (loadingSlow ? "The Website Model is taking longer than expected…" : "Loading the SENuke Website Model…")}</p><p className="mt-1 text-xs leading-5 text-slate-400">{message ? "Check the project data and retry the preview." : loadingSlow ? "The preview is still connected. You can wait or safely retry the request." : "Preparing the selected page, design theme, and responsive components."}</p>{(message || loadingSlow) && <div className="mt-4 flex justify-center gap-2"><button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="rounded-lg bg-white px-4 py-2.5 text-xs font-black text-slate-950">Retry Loading</button><button type="button" onClick={closeWorkspace} className="rounded-lg border border-white/20 px-4 py-2.5 text-xs font-black text-white">Close</button></div>}</div></div>;
  if (!build || !page) return <div className="grid min-h-screen place-items-center bg-slate-50 p-8 text-center"><div><h1 className="text-2xl font-black">No generated page is ready</h1><p className="mt-2 text-sm text-slate-500">Return to Site Architect and generate page content before opening the visual editor.</p><button onClick={closeWorkspace} className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">Close</button></div></div>;
  if (!pageDetailReady || loadingPageId === page.id) return <div className="grid min-h-screen place-items-center bg-slate-950 p-8 text-white"><div className="max-w-md text-center"><div className={`mx-auto h-9 w-9 rounded-full border-4 border-white/20 border-t-white ${message ? "" : "animate-spin"}`}/><p className="mt-4 text-sm font-black">{message || `Loading ${page.title}…`}</p><p className="mt-1 text-xs leading-5 text-slate-400">{message ? "The overview loaded, but the selected page body did not. Retry the page request." : "Loading this page separately keeps Website Builder fast and prevents oversized responses."}</p>{message&&<div className="mt-4 flex justify-center gap-2"><button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="rounded-lg bg-white px-4 py-2.5 text-xs font-black text-slate-950">Retry Page</button><button type="button" onClick={closeWorkspace} className="rounded-lg border border-white/20 px-4 py-2.5 text-xs font-black text-white">Close</button></div>}</div></div>;
  if (!draft?.content.length) return <div className="grid min-h-screen place-items-center bg-slate-50 p-8 text-center"><div><h1 className="text-2xl font-black">This page uses the earlier content format</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Regenerate {page.title} once in Site Architect. SENuke AI will convert it into approved registered components that can be edited visually.</p><button onClick={closeWorkspace} className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">Return to Site Architect</button></div></div>;

  if (mode === "preview") {
    return <div className="min-h-screen bg-slate-200">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-slate-950 px-4 py-3 text-white shadow-lg">
        <div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Dedicated review preview</div><div className="truncate text-sm font-black">{page.title} · Version {page.version}</div></div>
        <select value={page.id} onChange={(event) => setPageId(event.target.value)} className="rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-xs font-bold">{activePages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <div className="flex rounded-lg bg-white/10 p-1">{(["desktop", "tablet", "mobile"] as ViewMode[]).map((item) => <button key={item} onClick={() => setView(item)} className={`rounded-md px-3 py-1.5 text-xs font-black capitalize ${view === item ? "bg-white text-slate-950" : "text-slate-300"}`}>{item}</button>)}</div>
        {embedded && <button onClick={() => window.history.back()} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-black">← Back</button>}
        <button onClick={closeWorkspace} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-black">Close</button>
      </header>
      <main className="overflow-auto p-4 sm:p-7">
        <div className="mx-auto min-h-[calc(100vh-120px)] overflow-hidden bg-white shadow-2xl transition-[width] duration-300" style={{ ...theme, width: viewportWidth[view], maxWidth: "100%" }}>
          <Render config={config} data={draft} />
        </div>
      </main>
    </div>;
  }

  return <div className="senuke-puck-editor flex h-screen min-h-0 flex-col bg-slate-950">
    <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-950 px-4 py-2.5 text-white">
      <div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">SENuke Visual Website Editor</div><div className="truncate text-sm font-black">{page.title} · Page v{page.version} · Website Model v{response.websiteWorkflow.model?.version ?? "draft"}</div></div>
      <select value={page.id} onChange={(event) => setPageId(event.target.value)} className="rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-xs font-bold">{activePages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <button onClick={openPreview} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-black">Review Preview</button>
      <button onClick={closeWorkspace} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-black">Close</button>
    </div>
    {message ? <div className={`px-4 py-2 text-center text-xs font-bold ${/could not|required|unsupported/i.test(message) ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>{message}</div> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-[11px] font-bold text-indigo-950">
      <span><b>Build a layout:</b> drag <span className="whitespace-nowrap">Add section / columns</span> from the left, choose its columns, then drag content or images into each column.</span>
      <span><b>Style it:</b> select a section to change its background, image, spacing and text colour; select a content block for heading controls.</span>
    </div>
    <div className="min-h-0 flex-1" style={theme}>
      <Puck
        key={`${page.id}:${page.version}`}
        config={config}
        data={draft}
        onChange={(data) => setDraft(data as Data<PuckRecord>)}
        headerTitle={`${page.title} · visual draft`}
        headerPath={`/${page.slug}`}
        height="100%"
        iframe={{ enabled: true, waitForStyles: true, syncHostStyles: true }}
        plugins={[legacySideBarPlugin()]}
        viewports={[
          { width: 1440, height: "auto", label: "Desktop", icon: "Monitor" },
          { width: 820, height: "auto", label: "Tablet", icon: "Tablet" },
          { width: 390, height: "auto", label: "Mobile", icon: "Smartphone" },
        ]}
        overrides={{
          actionBar: ({ label, children, parentAction }) => <ActionBar>
            <ActionBar.Group>{parentAction}<ActionBar.Label label={`↕ Drag to move · ${label || "Section"}`} /></ActionBar.Group>
            <ActionBar.Group>{children}</ActionBar.Group>
          </ActionBar>,
          headerActions: () => <div className="flex items-center gap-2"><span className="hidden text-[10px] font-bold text-slate-500 md:inline">Saves a new Website Model version—not a live publication.</span><button type="button" disabled={saving} onClick={() => void save()} className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:bg-slate-300">{saving ? "Saving…" : "Save New Version"}</button></div>,
        }}
      />
    </div>
  </div>;
}
