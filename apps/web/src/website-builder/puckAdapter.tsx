import type { Config, Data } from "@puckeditor/core";
import { useState } from "react";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  validateComponentInstance,
  type JsonValue,
  type WebsiteComponentInstance,
} from "@webtummy/core/website-model";

// The registry is dynamic, so Puck props cannot be expressed as a fixed
// component-name map at compile time. Runtime validation below remains the
// source of truth for every field before a Website Model version is saved.
type PuckProps = Record<string, any> & { id?: string };
export type Theme = {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
  mutedText?: string;
  headingFont?: string;
  bodyFont?: string;
  radius?: string;
};
export type VisualMediaAsset = { id: string; sourceUrl: string | null; altText: string | null };
type SocialNetwork = "facebook" | "instagram" | "linkedin" | "youtube" | "x" | "tiktok";
export type WebsiteChrome = {
  businessName: string;
  previewMode?: "desktop" | "tablet" | "mobile";
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessAddress?: string;
  copyrightText?: string;
  socialProfiles?: Array<{ network: SocialNetwork; url: string }>;
  menu: Array<{ pageId: string; label: string; slug: string; parentPageId: string | null; custom?: boolean }>;
  onNavigate?: (pageId: string) => void;
};

const friendlyName = (value: string) => value
  .replaceAll(".", " ")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;
const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
const plainText = (value: unknown) => String(value ?? "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/p>\s*<p>/gi, "\n\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/[ \t]+\n/g, "\n")
  .trim();
const textParagraphs = (value: unknown) => plainText(value)
  .split(/\n{2,}/)
  .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
  .filter(Boolean);

const itemFields = {
  title: { type: "text" as const, label: "Title" },
  description: { type: "textarea" as const, label: "Description" },
  question: { type: "text" as const, label: "Question" },
  answer: { type: "textarea" as const, label: "Answer" },
  label: { type: "text" as const, label: "Link label" },
  url: { type: "text" as const, label: "Link URL" },
};

function registryField(fieldName: string, definition: { type: string; maxItems?: number }, mediaAssets: VisualMediaAsset[], allowedChildren: readonly string[] = []) {
  const label = friendlyName(fieldName);
  if (fieldName === "alignment") return {
    type: "radio" as const,
    label: "Section alignment",
    options: [
      { label: "Left", value: "left" },
      { label: "Centre", value: "center" },
      { label: "Right", value: "right" },
    ],
  };
  if (fieldName === "headingSize") return {
    type: "select" as const,
    label: "Heading size",
    options: [{ label: "Small", value: "small" }, { label: "Medium", value: "medium" }, { label: "Large", value: "large" }],
  };
  if (fieldName === "headingWeight") return {
    type: "select" as const,
    label: "Heading weight",
    options: [{ label: "Regular", value: "regular" }, { label: "Semi-bold", value: "semibold" }, { label: "Bold", value: "bold" }, { label: "Extra bold", value: "black" }],
  };
  if (fieldName === "headingColor") return {
    type: "select" as const,
    label: "Heading colour",
    options: [{ label: "Default", value: "default" }, { label: "Primary brand", value: "primary" }, { label: "Secondary brand", value: "secondary" }, { label: "Accent", value: "accent" }, { label: "Body text", value: "text" }],
  };
  if (fieldName === "backgroundColor") return {
    type: "select" as const,
    label: "Section background",
    options: [
      { label: "Default", value: "default" },
      { label: "Page background", value: "background" },
      { label: "White / surface", value: "surface" },
      { label: "Primary brand", value: "primary" },
      { label: "Secondary brand", value: "secondary" },
      { label: "Accent", value: "accent" },
      { label: "Dark", value: "dark" },
    ],
  };
  if (fieldName === "textColor") return {
    type: "select" as const,
    label: "Section text colour",
    options: [{ label: "Automatic", value: "auto" }, { label: "Body text", value: "text" }, { label: "Muted text", value: "muted" }, { label: "White", value: "white" }],
  };
  if (fieldName === "backgroundOverlay") return {
    type: "select" as const,
    label: "Image overlay",
    options: [{ label: "None", value: 0 }, { label: "Light", value: 20 }, { label: "Medium", value: 40 }, { label: "Strong", value: 60 }, { label: "Very strong", value: 80 }],
  };
  if (fieldName === "spacing") return {
    type: "select" as const,
    label: "Section spacing",
    options: [{ label: "Compact", value: "compact" }, { label: "Comfortable", value: "comfortable" }, { label: "Spacious", value: "spacious" }],
  };
  if (definition.type === "component_slot") return {
    type: "slot" as const,
    label,
    allow: [...allowedChildren],
  };
  if (definition.type === "asset_id") return {
    type: "select" as const,
    label,
    options: [{ label: "No image", value: "" }, ...mediaAssets.filter((asset) => asset.sourceUrl).map((asset, index) => ({ label: asset.altText || `Page image ${index + 1}`, value: asset.id }))],
  };
  if (definition.type === "rich_text") return { type: "textarea" as const, label };
  if (definition.type === "boolean") return { type: "radio" as const, label, options: [{ label: "Yes", value: true }, { label: "No", value: false }] };
  if (definition.type === "number") return { type: "number" as const, label };
  if (definition.type === "object_list" && fieldName === "fields") return {
    type: "array" as const,
    label,
    arrayFields: {
      label: { type: "text" as const, label: "Field label" },
      name: { type: "text" as const, label: "Field name" },
      inputType: {
        type: "select" as const,
        label: "Input type",
        options: [
          { label: "Text", value: "text" },
          { label: "Email", value: "email" },
          { label: "Phone", value: "tel" },
          { label: "Message", value: "textarea" },
          { label: "Consent", value: "checkbox" },
        ],
      },
      required: { type: "radio" as const, label: "Required", options: [{ label: "Yes", value: true }, { label: "No", value: false }] },
    },
    defaultItemProps: { label: "", name: "", inputType: "text", required: false },
    getItemSummary: (item: Record<string, unknown>, index: number) => text(item.label, `Field ${index + 1}`),
    max: definition.maxItems,
  };
  if (definition.type === "object_list") return {
    type: "array" as const,
    label,
    arrayFields: itemFields,
    defaultItemProps: { title: "", description: "", question: "", answer: "", label: "", url: "" },
    getItemSummary: (item: Record<string, unknown>, index: number) => text(item.title || item.question || item.label, `Item ${index + 1}`),
    max: definition.maxItems,
  };
  return { type: definition.maxItems && definition.maxItems > 1 ? "textarea" as const : "text" as const, label };
}

function SectionShell({ children, tone = "light", className = "" }: { children: React.ReactNode; tone?: "light" | "soft" | "dark"; className?: string }) {
  const background = tone === "dark" ? "var(--senuke-secondary)" : tone === "soft" ? "var(--senuke-background)" : "var(--senuke-surface)";
  const color = tone === "dark" ? "#fff" : "var(--senuke-text)";
  return <section className={`senuke-section-shell ${className}`} style={{ padding: "clamp(42px, 7vw, 88px) 7%", background, color }}>{children}</section>;
}

const VISUAL_EDITOR_CSS = `
.senuke-site-canvas{min-height:100vh;overflow:hidden;background:var(--senuke-background)}
.senuke-site-canvas *{box-sizing:border-box}
.senuke-global-header{position:sticky!important;top:0;backdrop-filter:blur(16px);background:color-mix(in srgb,var(--senuke-surface) 92%,transparent)!important;box-shadow:0 10px 35px rgba(15,23,42,.06)}
.senuke-mobile-navigation-button,.senuke-mobile-navigation-panel{display:none}
.senuke-section-shell{position:relative}
.senuke-layout-section{position:relative;isolation:isolate;overflow:hidden;padding:clamp(28px,5vw,72px) 7%}
.senuke-layout-section-bg{position:absolute;z-index:-2;inset:0;width:100%;height:100%;object-fit:cover}
.senuke-layout-section-overlay{position:absolute;z-index:-1;inset:0;background:#020617}
.senuke-layout-columns{width:min(1180px,100%);margin:auto;display:grid;gap:clamp(18px,3vw,36px);align-items:stretch}
.senuke-layout-one_column{grid-template-columns:minmax(0,1fr)}
.senuke-layout-two_equal{grid-template-columns:repeat(2,minmax(0,1fr))}
.senuke-layout-two_left_wide{grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr)}
.senuke-layout-two_right_wide{grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr)}
.senuke-layout-three_equal{grid-template-columns:repeat(3,minmax(0,1fr))}
.senuke-layout-column{min-width:0;min-height:150px;border:1px dashed color-mix(in srgb,var(--senuke-primary) 34%,transparent);border-radius:var(--senuke-radius);background:color-mix(in srgb,var(--senuke-surface) 12%,transparent);padding:10px}
.senuke-layout-column:before{content:attr(data-column-label);display:block;padding:2px 4px 9px;color:currentColor;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.55}
.senuke-layout-column .senuke-section-shell{padding:clamp(18px,3vw,34px)!important;background:transparent!important}
.senuke-layout-column .senuke-rich-section>div,.senuke-layout-column .senuke-contact-form-section>div{grid-template-columns:1fr!important;gap:20px!important}
.senuke-layout-column .senuke-cta-section{margin:0!important}
.senuke-layout-text-white .senuke-layout-column h1,.senuke-layout-text-white .senuke-layout-column h2,.senuke-layout-text-white .senuke-layout-column h3,.senuke-layout-text-white .senuke-layout-column p,.senuke-layout-auto-white .senuke-layout-column h1,.senuke-layout-auto-white .senuke-layout-column h2,.senuke-layout-auto-white .senuke-layout-column h3,.senuke-layout-auto-white .senuke-layout-column p{color:#fff!important}
.senuke-layout-spacing-compact{padding-top:28px;padding-bottom:28px}.senuke-layout-spacing-comfortable{padding-top:clamp(46px,6vw,76px);padding-bottom:clamp(46px,6vw,76px)}.senuke-layout-spacing-spacious{padding-top:clamp(70px,9vw,120px);padding-bottom:clamp(70px,9vw,120px)}
.senuke-section-shell>div,.senuke-section-shell>h2,.senuke-section-shell>p{width:min(1180px,100%);margin-left:auto;margin-right:auto}
.senuke-align-center{text-align:center}
.senuke-align-right{text-align:right}
.senuke-align-center>h2,.senuke-align-center>p,.senuke-align-center>div>h2,.senuke-align-center>div>p,.senuke-align-center>div>div>h2,.senuke-align-center>div>div>p{margin-left:auto!important;margin-right:auto!important;text-align:center}
.senuke-align-right>h2,.senuke-align-right>p,.senuke-align-right>div>h2,.senuke-align-right>div>p,.senuke-align-right>div>div>h2,.senuke-align-right>div>div>p{margin-left:auto!important;margin-right:0!important;text-align:right}
.senuke-rich-section.senuke-align-center>div,.senuke-rich-section.senuke-align-right>div{display:block;max-width:920px}
.senuke-rich-section.senuke-align-center>div>p,.senuke-rich-section.senuke-align-right>div>p{margin-top:18px!important}
.senuke-heading-small h1,.senuke-heading-small h2{font-size:clamp(26px,3vw,38px)!important}.senuke-heading-medium h1,.senuke-heading-medium h2{font-size:clamp(32px,4vw,50px)!important}.senuke-heading-large h1,.senuke-heading-large h2{font-size:clamp(42px,6vw,72px)!important}
.senuke-heading-regular h1,.senuke-heading-regular h2{font-weight:500!important}.senuke-heading-semibold h1,.senuke-heading-semibold h2{font-weight:650!important}.senuke-heading-bold h1,.senuke-heading-bold h2{font-weight:800!important}.senuke-heading-black h1,.senuke-heading-black h2{font-weight:950!important}
.senuke-heading-color-primary h1,.senuke-heading-color-primary h2{color:var(--senuke-primary)!important}.senuke-heading-color-secondary h1,.senuke-heading-color-secondary h2{color:var(--senuke-secondary)!important}.senuke-heading-color-accent h1,.senuke-heading-color-accent h2{color:var(--senuke-accent)!important}.senuke-heading-color-text h1,.senuke-heading-color-text h2{color:var(--senuke-text)!important}
.senuke-hero-section{isolation:isolate;min-height:680px;display:grid;align-items:center;background:
 radial-gradient(circle at 88% 12%,color-mix(in srgb,var(--senuke-accent) 24%,transparent),transparent 28%),
 radial-gradient(circle at 8% 84%,color-mix(in srgb,var(--senuke-primary) 17%,transparent),transparent 30%),
 linear-gradient(135deg,var(--senuke-background),var(--senuke-surface) 56%,color-mix(in srgb,var(--senuke-secondary) 10%,white))!important}
.senuke-hero-section:before{content:"";position:absolute;inset:9% auto auto 4%;width:88px;height:6px;border-radius:99px;background:var(--senuke-accent)}
.senuke-hero-section h1{letter-spacing:-.045em;text-wrap:balance}
.senuke-rich-section:nth-of-type(even){background:color-mix(in srgb,var(--senuke-primary) 4%,var(--senuke-surface))!important}
.senuke-rich-section>div{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.3fr);gap:clamp(28px,6vw,86px);align-items:start}
.senuke-rich-section h2{margin-top:0;letter-spacing:-.025em;text-wrap:balance}
.senuke-services-section article{position:relative;overflow:hidden;min-height:210px;padding:28px!important;border:0!important;box-shadow:0 18px 55px rgba(15,23,42,.08);transition:transform .2s ease,box-shadow .2s ease}
.senuke-services-section article:before{content:"";position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(var(--senuke-primary),var(--senuke-accent))}
.senuke-services-section article:hover{transform:translateY(-5px);box-shadow:0 26px 70px rgba(15,23,42,.14)}
.senuke-benefits-section{background:var(--senuke-secondary)!important;color:#fff!important}
.senuke-benefits-section article{background:rgba(255,255,255,.1)!important;color:#fff;border:1px solid rgba(255,255,255,.16)!important;box-shadow:none}
.senuke-benefits-section article:before{content:"✓";display:grid;place-items:center;width:34px;height:34px;margin-bottom:18px;border-radius:99px;background:var(--senuke-accent);color:var(--senuke-text);font-weight:1000}
.senuke-benefits-section article p{color:rgba(255,255,255,.75)!important}
.senuke-process-section>div{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))!important;gap:20px!important}
.senuke-process-section>div>div{display:block!important;padding:24px;border-radius:var(--senuke-radius);background:var(--senuke-surface);box-shadow:0 16px 45px rgba(15,23,42,.07)}
.senuke-proof-section{background:linear-gradient(135deg,color-mix(in srgb,var(--senuke-accent) 13%,white),var(--senuke-surface))!important}
.senuke-faq-section>div{width:min(920px,100%)}
.senuke-faq-section details{background:var(--senuke-surface);box-shadow:0 10px 30px rgba(15,23,42,.05)}
.senuke-cta-section{position:relative;overflow:hidden;box-shadow:0 28px 80px color-mix(in srgb,var(--senuke-secondary) 35%,transparent)}
.senuke-cta-section:after{content:"";position:absolute;right:-80px;bottom:-120px;width:300px;height:300px;border-radius:50%;background:color-mix(in srgb,var(--senuke-accent) 28%,transparent)}
@media(max-width:860px){.senuke-layout-columns{grid-template-columns:1fr!important}}
@media(max-width:860px){.senuke-global-header{position:sticky!important;top:0!important;display:flex!important;min-height:68px!important;flex-wrap:nowrap!important;padding:8px 6%!important}.senuke-global-header>a{max-width:calc(100% - 64px)}.senuke-global-header>a img{max-width:min(160px,100%)!important;height:44px!important}.senuke-desktop-navigation{display:none!important}.senuke-mobile-navigation-button{display:grid;width:46px;height:46px;flex:0 0 46px;cursor:pointer;place-items:center;border:1px solid #cbd5e1;border-radius:12px;background:var(--senuke-surface);color:var(--senuke-text)}.senuke-mobile-navigation-button>span{display:grid;width:22px;gap:4px}.senuke-mobile-navigation-button i{display:block;height:2px;border-radius:99px;background:currentColor;transition:transform .2s ease,opacity .2s ease}.senuke-mobile-navigation-button[aria-expanded="true"] i:nth-child(1){transform:translateY(6px) rotate(45deg)}.senuke-mobile-navigation-button[aria-expanded="true"] i:nth-child(2){opacity:0}.senuke-mobile-navigation-button[aria-expanded="true"] i:nth-child(3){transform:translateY(-6px) rotate(-45deg)}.senuke-mobile-navigation-panel{position:absolute;z-index:100;inset:100% 0 auto;display:block;width:100%;max-height:calc(100dvh - 68px);overflow-y:auto;overscroll-behavior:contain;border-top:1px solid #e2e8f0;background:var(--senuke-surface);padding:14px 6% 20px;box-shadow:0 24px 45px rgba(15,23,42,.18)}.senuke-mobile-navigation{display:grid!important;align-items:stretch!important;gap:3px!important}.senuke-mobile-navigation>a,.senuke-mobile-navigation>details>summary{padding:12px!important}.senuke-mobile-navigation details>div{position:static!important;min-width:0!important;margin:2px 0 6px 12px!important;padding:3px 0 3px 9px!important;border-width:0 0 0 2px!important;border-radius:0!important;box-shadow:none!important}.senuke-hero-section{min-height:auto}.senuke-hero-section>div,.senuke-rich-section>div,.senuke-contact-form-section>div{grid-template-columns:1fr!important}.senuke-contact-form-section form{grid-template-columns:1fr!important}.senuke-contact-form-section form>*{grid-column:1!important}.senuke-section-shell{padding-left:6%!important;padding-right:6%!important}.senuke-cta-section{margin-inline:4%!important;padding-inline:7%!important}.senuke-global-footer>div:first-child{grid-template-columns:1fr!important}.senuke-global-footer nav{justify-content:flex-start!important}}
@media(max-width:540px){.senuke-section-shell{padding-top:42px!important;padding-bottom:42px!important}.senuke-hero-section h1{font-size:clamp(34px,11vw,52px)!important}.senuke-services-section>div,.senuke-process-section>div{grid-template-columns:1fr!important}.senuke-global-footer{padding-left:6%!important;padding-right:6%!important}}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-global-header{position:sticky!important;top:0!important;display:flex!important;min-height:68px!important;flex-wrap:nowrap!important;padding:8px 6%!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-global-header>a{max-width:calc(100% - 64px)}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-global-header>a img{max-width:min(160px,100%)!important;height:44px!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-desktop-navigation{display:none!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-mobile-navigation-button{display:grid!important;width:46px;height:46px;flex:0 0 46px;cursor:pointer;place-items:center;border:1px solid #cbd5e1;border-radius:12px;background:var(--senuke-surface);color:var(--senuke-text)}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-mobile-navigation-button>span{display:grid;width:22px;gap:4px}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-mobile-navigation-button i{display:block;height:2px;border-radius:99px;background:currentColor}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-mobile-navigation-panel{position:absolute;z-index:100;inset:100% 0 auto;display:block!important;width:100%;max-height:calc(100dvh - 68px);overflow-y:auto;background:var(--senuke-surface);padding:14px 6% 20px;box-shadow:0 24px 45px rgba(15,23,42,.18)}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-mobile-navigation{display:grid!important;align-items:stretch!important;gap:3px!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-mobile-navigation details>div{position:static!important;min-width:0!important;margin:2px 0 6px 12px!important;padding:3px 0 3px 9px!important;box-shadow:none!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-hero-section{min-height:auto}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-hero-section>div,.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-rich-section>div,.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-contact-form-section>div{grid-template-columns:1fr!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-contact-form-section form{grid-template-columns:1fr!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-contact-form-section form>*{grid-column:1!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-section-shell{padding-left:6%!important;padding-right:6%!important}
.senuke-site-canvas:is([data-preview-viewport="tablet"],[data-preview-viewport="mobile"]) .senuke-global-footer>div:first-child{grid-template-columns:1fr!important}
.senuke-site-canvas[data-preview-viewport="mobile"] .senuke-section-shell{padding-top:42px!important;padding-bottom:42px!important}
.senuke-site-canvas[data-preview-viewport="mobile"] .senuke-hero-section h1{font-size:clamp(34px,11vw,52px)!important}
.senuke-site-canvas[data-preview-viewport="mobile"] .senuke-services-section>div,.senuke-site-canvas[data-preview-viewport="mobile"] .senuke-process-section>div{grid-template-columns:1fr!important}
`;

function GlobalWebsiteHeader({ chrome }: { chrome: WebsiteChrome }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openRootMenuId, setOpenRootMenuId] = useState<string | null>(null);
  const renderItem = (item: WebsiteChrome["menu"][number], depth = 0): React.ReactNode => {
    const children = chrome.menu.filter((candidate) => candidate.parentPageId === item.pageId);
    const destination = item.slug
      ? (/^(?:https?:\/\/|mailto:|tel:|#)/i.test(item.slug) ? item.slug : `/${item.slug.replace(/^\/+|\/+$/g, "")}${item.slug === "/" ? "" : "/"}`)
      : "";
    const activate = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!item.custom && chrome.onNavigate) {
        event.preventDefault();
        chrome.onNavigate(item.pageId);
      } else if (!destination) event.preventDefault();
      setMobileOpen(false);
      setOpenRootMenuId(null);
    };
    if (children.length) {
      const controlsRootMenu = depth === 0;
      return <details
        key={item.pageId}
        open={controlsRootMenu ? openRootMenuId === item.pageId : undefined}
        onToggle={controlsRootMenu ? (event) => {
          const isOpen = event.currentTarget.open;
          setOpenRootMenuId((current) => isOpen ? item.pageId : current === item.pageId ? null : current);
        } : undefined}
        style={{ position: "relative" }}
      ><summary style={{ cursor: "pointer", listStyle: "none", padding: depth ? "8px 10px" : "10px 6px", color: "var(--senuke-text)", fontSize: depth ? 13 : 14, fontWeight: 800 }}>{item.label} <span aria-hidden="true" style={{ color: "var(--senuke-muted)", fontSize: 10 }}>▾</span></summary><div style={{ position: depth ? "static" : "absolute", right: depth ? "auto" : 0, zIndex: 30, display: "grid", minWidth: 210, gap: 2, border: "1px solid #e2e8f0", borderRadius: "var(--senuke-radius)", background: "var(--senuke-surface)", padding: 8, boxShadow: "0 18px 45px rgba(15,23,42,.14)" }}>{children.map((child) => renderItem(child, depth + 1))}</div></details>;
    }
    return <a key={item.pageId} href={destination || "#"} onClick={activate} style={{ display: "block", borderRadius: 8, padding: depth ? "8px 10px" : "10px 6px", color: "var(--senuke-text)", fontSize: depth ? 13 : 14, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}>{item.label}</a>;
  };
  const roots = chrome.menu.filter((item) => !item.parentPageId);
  return <header className="senuke-global-header" style={{ position: "relative", zIndex: 40, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "14px 28px", minHeight: 76, padding: "12px 7%", borderBottom: "1px solid #e2e8f0", background: "var(--senuke-surface)" }}><a href="/" onClick={(event) => { const home = chrome.menu.find((item) => !item.custom && (!item.slug || item.slug === "/")); if (home && chrome.onNavigate) { event.preventDefault(); chrome.onNavigate(home.pageId); setMobileOpen(false); setOpenRootMenuId(null); } }} style={{ display: "flex", minWidth: 0, alignItems: "center", color: "var(--senuke-text)", fontSize: 20, fontWeight: 900, textDecoration: "none" }}>{chrome.logoUrl ? <img src={chrome.logoUrl} alt={`${chrome.businessName} logo`} style={{ display: "block", width: "auto", maxWidth: 190, height: 52, objectFit: "contain" }}/> : chrome.businessName}</a><nav className="senuke-desktop-navigation" aria-label="Primary navigation" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 14px" }}>{roots.map((item) => renderItem(item))}</nav><button type="button" className="senuke-mobile-navigation-button" aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileOpen} onClick={() => { setMobileOpen((open) => !open); setOpenRootMenuId(null); }}><span aria-hidden="true"><i/><i/><i/></span></button>{mobileOpen ? <div className="senuke-mobile-navigation-panel"><nav className="senuke-mobile-navigation" aria-label="Mobile navigation">{roots.map((item) => renderItem(item))}</nav></div> : null}</header>;
}

function GlobalWebsiteFooter({ chrome }: { chrome: WebsiteChrome }) {
  const contact = [
    chrome.contactPhone ? <a key="phone" href={`tel:${chrome.contactPhone.replace(/[^\d+]/g, "")}`} style={{ color: "inherit" }}>{chrome.contactPhone}</a> : null,
    chrome.contactEmail ? <a key="email" href={`mailto:${chrome.contactEmail}`} style={{ color: "inherit" }}>{chrome.contactEmail}</a> : null,
    chrome.businessAddress ? <span key="address">{chrome.businessAddress}</span> : null,
  ].filter(Boolean);
  const socialProfiles = (chrome.socialProfiles ?? []).filter((profile) => /^https:\/\//i.test(profile.url));
  const socialMeta: Record<SocialNetwork, { label: string; mark: string }> = {
    facebook: { label: "Facebook", mark: "f" },
    instagram: { label: "Instagram", mark: "◎" },
    linkedin: { label: "LinkedIn", mark: "in" },
    youtube: { label: "YouTube", mark: "▶" },
    x: { label: "X", mark: "𝕏" },
    tiktok: { label: "TikTok", mark: "♪" },
  };
  const footerItems = chrome.menu.filter((item) => !item.parentPageId).slice(0, 8);
  const activate = (item: WebsiteChrome["menu"][number], event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!item.custom && chrome.onNavigate) {
      event.preventDefault();
      chrome.onNavigate(item.pageId);
    }
  };
  return <footer className="senuke-global-footer" style={{ padding: "48px 7% 24px", background: "var(--senuke-text)", color: "#fff" }}><div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(260px,1fr)", gap: "30px 64px", alignItems: "start" }}><div><b style={{ fontSize: 22 }}>{chrome.businessName}</b>{contact.length ? <div style={{ display: "grid", gap: 8, marginTop: 14, color: "#cbd5e1", fontSize: 14 }}>{contact}</div> : <p style={{ marginTop: 14, color: "#fbbf24", fontSize: 13, fontWeight: 750 }}>Add the verified phone and email in Brand Foundation before approval.</p>}{socialProfiles.length ? <nav aria-label="Social media" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>{socialProfiles.map((profile) => { const meta = socialMeta[profile.network]; return <a key={profile.network} href={profile.url} target="_blank" rel="noreferrer" aria-label={meta.label} title={meta.label} style={{ display: "grid", width: 40, height: 40, placeItems: "center", border: "1px solid rgba(255,255,255,.22)", borderRadius: 999, background: "rgba(255,255,255,.08)", color: "#fff", fontSize: profile.network === "linkedin" ? 12 : 17, fontWeight: 900, lineHeight: 1, textDecoration: "none" }}>{meta.mark}</a>; })}</nav> : null}</div>{footerItems.length ? <nav aria-label="Footer navigation" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "10px 22px" }}>{footerItems.map((item) => { const href = item.slug ? (/^(?:https?:\/\/|mailto:|tel:|#)/i.test(item.slug) ? item.slug : `/${item.slug.replace(/^\/+|\/+$/g, "")}${item.slug === "/" ? "" : "/"}`) : "#"; return <a key={item.pageId} href={href} onClick={(event) => activate(item, event)} style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 750, textDecoration: "none" }}>{item.label}</a>; })}</nav> : null}</div><div style={{ marginTop: 34, borderTop: "1px solid rgba(255,255,255,.16)", paddingTop: 18, color: "#94a3b8", fontSize: 12 }}>{chrome.copyrightText || `© ${new Date().getFullYear()} ${chrome.businessName}. All rights reserved.`}</div></footer>;
}

const normalizedInternalPath = (value: string) => {
  if (!value || /^(?:https?:\/\/|mailto:|tel:|#)/i.test(value)) return "";
  const clean = value.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, "").toLowerCase();
  return clean ? `/${clean}/` : "/";
};

function WebsiteActionLink({ href, chrome, children, style }: { href: string; chrome?: WebsiteChrome; children: React.ReactNode; style?: React.CSSProperties }) {
  const destination = normalizedInternalPath(href);
  const exactTarget = destination && chrome?.menu.find((item) => {
    if (item.custom) return false;
    const itemPath = normalizedInternalPath(item.slug || "/");
    return itemPath === destination;
  });
  const target = exactTarget || (destination === "/contact/"
    ? chrome?.menu.find((item) => !item.custom && /\b(contact|get in touch|request (?:a )?quote)\b/i.test(`${item.label} ${item.slug}`))
    : undefined);
  return <a href={href || "#"} onClick={(event) => {
    if (target && chrome?.onNavigate) {
      event.preventDefault();
      chrome.onNavigate(target.pageId);
    } else if (!href) event.preventDefault();
  }} style={style}>{children}</a>;
}

function RegisteredComponent({ componentId, props, mediaAssets, chrome }: { componentId: string; props: PuckProps; mediaAssets: VisualMediaAsset[]; chrome?: WebsiteChrome }) {
  const [submitted, setSubmitted] = useState(false);
  const heading = text(props.heading);
  const items = list(props.items);
  const contactFields = list(props.fields);
  const imageAsset = mediaAssets.find((asset) => asset.id === props.imageAssetId);
  const alignment = ["left", "center", "right"].includes(text(props.alignment)) ? text(props.alignment) : "left";
  let alignmentClass = `senuke-align-${alignment}`;
  const headingSize = ["small", "medium", "large"].includes(text(props.headingSize)) ? text(props.headingSize) : "medium";
  const headingWeight = ["regular", "semibold", "bold", "black"].includes(text(props.headingWeight)) ? text(props.headingWeight) : "bold";
  const headingColor = ["default", "primary", "secondary", "accent", "text"].includes(text(props.headingColor)) ? text(props.headingColor) : "default";
  alignmentClass += ` senuke-heading-${headingSize} senuke-heading-${headingWeight} senuke-heading-color-${headingColor}`;
  if (componentId === "layout.section") {
    const variant = ["one_column", "two_equal", "two_left_wide", "two_right_wide", "three_equal"].includes(text(props.variant)) ? text(props.variant) : "two_equal";
    const columnCount = variant === "one_column" ? 1 : variant === "three_equal" ? 3 : 2;
    const slotNames = ["columnOne", "columnTwo", "columnThree"].slice(0, columnCount);
    const backgroundKey = ["default", "background", "surface", "primary", "secondary", "accent", "dark"].includes(text(props.backgroundColor)) ? text(props.backgroundColor) : "default";
    const background = backgroundKey === "background" ? "var(--senuke-background)"
      : backgroundKey === "primary" ? "var(--senuke-primary)"
      : backgroundKey === "secondary" ? "var(--senuke-secondary)"
      : backgroundKey === "accent" ? "var(--senuke-accent)"
      : backgroundKey === "dark" ? "var(--senuke-text)"
      : "var(--senuke-surface)";
    const requestedText = ["auto", "text", "muted", "white"].includes(text(props.textColor)) ? text(props.textColor) : "auto";
    const color = requestedText === "white" ? "#fff"
      : requestedText === "muted" ? "var(--senuke-muted)"
      : requestedText === "text" ? "var(--senuke-text)"
      : ["primary", "secondary", "dark"].includes(backgroundKey) ? "#fff" : "var(--senuke-text)";
    const backgroundImage = mediaAssets.find((asset) => asset.id === props.backgroundImageAssetId);
    const spacing = ["compact", "comfortable", "spacious"].includes(text(props.spacing)) ? text(props.spacing) : "comfortable";
    const overlay = typeof props.backgroundOverlay === "number" ? Math.max(0, Math.min(90, props.backgroundOverlay)) : 40;
    return <section className={`senuke-layout-section senuke-layout-spacing-${spacing} senuke-layout-text-${requestedText} ${requestedText === "auto" && ["primary", "secondary", "dark"].includes(backgroundKey) ? "senuke-layout-auto-white" : ""}`} style={{ background, color }}>
      {backgroundImage?.sourceUrl ? <img className="senuke-layout-section-bg" src={backgroundImage.sourceUrl} alt="" aria-hidden="true"/> : null}
      {backgroundImage?.sourceUrl && overlay > 0 ? <span className="senuke-layout-section-overlay" style={{ opacity: overlay / 100 }}/> : null}
      <div className={`senuke-layout-columns senuke-layout-${variant}`}>
        {slotNames.map((slotName, index) => {
          const Slot = props[slotName];
          return <div key={slotName} className="senuke-layout-column" data-column-label={`Column ${index + 1}`}>
            {typeof Slot === "function" ? <Slot minEmptyHeight={130}/> : null}
          </div>;
        })}
      </div>
    </section>;
  }
  if (componentId === "global.header") return <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "18px 7%", borderBottom: "1px solid #e2e8f0", background: "var(--senuke-surface)" }}><b style={{ color: "var(--senuke-primary)", fontSize: 20 }}>{text(props.businessName, "Business name")}</b><WebsiteActionLink href={text(props.primaryCtaUrl, "/contact/")} chrome={chrome} style={{ borderRadius: "var(--senuke-radius)", background: "var(--senuke-primary)", color: "#fff", padding: "11px 16px", fontWeight: 800, textDecoration: "none" }}>{text(props.primaryCtaLabel, "Contact us")}</WebsiteActionLink></header>;
  if (componentId === "hero.local_service") return <SectionShell tone="soft" className={`senuke-hero-section ${alignmentClass}`}><div style={{ display: "grid", gridTemplateColumns: imageAsset?.sourceUrl ? "minmax(0,1.15fr) minmax(280px,.85fr)" : "1fr", alignItems: "center", gap: "clamp(28px,6vw,70px)" }}><div style={{ maxWidth: 980 }}><div style={{ color: "var(--senuke-secondary)", fontSize: 12, fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>{text(props.eyebrow, "Service")}</div><h1 style={{ margin: alignment === "center" ? "18px auto" : alignment === "right" ? "18px 0 18px auto" : "18px 0", fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(40px, 6vw, 72px)", lineHeight: 1.04 }}>{text(props.headline, "Clear service headline")}</h1><p style={{ marginLeft: alignment === "center" ? "auto" : alignment === "right" ? "auto" : undefined, marginRight: alignment === "center" ? "auto" : alignment === "right" ? 0 : undefined, maxWidth: 780, color: "var(--senuke-muted)", fontSize: 19, lineHeight: 1.75 }}>{text(props.summary, "Explain the service, audience, and desired result.")}</p><WebsiteActionLink href={text(props.primaryCtaUrl, "/contact/")} chrome={chrome} style={{ display: "inline-block", marginTop: 18, borderRadius: "var(--senuke-radius)", background: "var(--senuke-primary)", color: "#fff", padding: "14px 22px", fontWeight: 900, textDecoration: "none", boxShadow: "0 14px 35px color-mix(in srgb,var(--senuke-primary) 35%,transparent)" }}>{text(props.primaryCtaLabel, "Get started")}</WebsiteActionLink></div>{imageAsset?.sourceUrl&&<img src={imageAsset.sourceUrl} alt={imageAsset.altText||text(props.headline)} style={{ width: "100%", aspectRatio: "3 / 2", maxHeight: 560, objectFit: "cover", borderRadius: "calc(var(--senuke-radius) * 1.4)", boxShadow: "0 30px 80px rgba(15,23,42,.2)" }}/>}</div></SectionShell>;
  if (componentId === "content.rich_text") return <SectionShell className={`senuke-rich-section senuke-rich-${text(props.variant,"standard")} ${alignmentClass}`}><div><h2 style={{ fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(30px,4vw,46px)" }}>{heading || "Content section"}</h2>{textParagraphs(props.body).map((paragraph, index) => <p key={index} style={{ marginTop: index ? 14 : 0, color: "var(--senuke-muted)", fontSize: 17, lineHeight: 1.9 }}>{paragraph}</p>)}</div></SectionShell>;
  if (componentId === "media.image") return <figure style={{ width: props.variant === "wide" ? "100%" : "min(1040px,86%)", margin: props.variant === "wide" ? "0 auto" : "44px auto", padding: props.variant === "card" ? 14 : 0, borderRadius: "calc(var(--senuke-radius) * 1.4)", background: props.variant === "card" ? "var(--senuke-surface)" : "transparent", boxShadow: props.variant === "card" ? "0 18px 50px rgba(15,23,42,.12)" : "none" }}>{imageAsset?.sourceUrl?<img src={imageAsset.sourceUrl} alt={text(props.altText,imageAsset.altText||"")} style={{ display: "block", width: "100%", maxHeight: props.variant === "wide" ? 620 : 520, objectFit: "cover", borderRadius: "var(--senuke-radius)" }}/>:<div style={{ display: "grid", minHeight: 260, placeItems: "center", border: "2px dashed #cbd5e1", borderRadius: "var(--senuke-radius)", color: "#64748b" }}>Choose a generated page image</div>}{Boolean(props.caption)&&<figcaption style={{ padding: "12px 4px 0", color: "var(--senuke-muted)", fontSize: 14 }}>{text(props.caption)}</figcaption>}</figure>;
  if (componentId === "service.grid" || componentId === "service.benefits") return <SectionShell tone="soft" className={`${componentId === "service.benefits" ? "senuke-services-section senuke-benefits-section" : "senuke-services-section"} ${alignmentClass}`}><h2 style={{ fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(30px,4vw,46px)" }}>{heading || (componentId === "service.grid" ? "Services" : "Benefits")}</h2>{props.introduction ? <p style={{ maxWidth: 800, color: "var(--senuke-muted)", fontSize: 17, lineHeight: 1.7 }}>{text(props.introduction)}</p> : null}<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 18, marginTop: 30 }}>{items.map((item, index) => <article key={index} style={{ border: "1px solid #e2e8f0", borderRadius: "var(--senuke-radius)", background: "var(--senuke-surface)", padding: 22 }}><div style={{ color: "var(--senuke-primary)", fontSize: 12, fontWeight: 900 }}>0{index + 1}</div><h3>{text(item.title, `Item ${index + 1}`)}</h3><p style={{ color: "var(--senuke-muted)", lineHeight: 1.7 }}>{text(item.description)}</p></article>)}</div></SectionShell>;
  if (componentId === "content.process") return <SectionShell className={`senuke-process-section ${alignmentClass}`}><h2 style={{ fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(30px,4vw,46px)" }}>{heading || "How the process works"}</h2><div style={{ display: "grid", gap: 14, marginTop: 30 }}>{list(props.steps).map((item, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 14, alignItems: "start" }}><b style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 99, background: "var(--senuke-primary)", color: "#fff" }}>{index + 1}</b><div><h3 style={{ margin: "18px 0 0" }}>{text(item.title, `Step ${index + 1}`)}</h3><p style={{ color: "var(--senuke-muted)", lineHeight: 1.7 }}>{text(item.description)}</p></div></div>)}</div></SectionShell>;
  if (componentId === "trust.proof") return <SectionShell tone="soft" className={`senuke-proof-section ${alignmentClass}`}><h2 style={{ fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(30px,4vw,46px)" }}>{heading || "Evidence and trust"}</h2><p style={{ maxWidth: 800, color: "var(--senuke-muted)", lineHeight: 1.7 }}>{text(props.introduction)}</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, marginTop: 24 }}>{items.map((item, index) => <article key={index} style={{ borderLeft: "5px solid var(--senuke-accent)", borderRadius: "0 var(--senuke-radius) var(--senuke-radius) 0", background: "var(--senuke-surface)", padding: 24, boxShadow: "0 15px 40px rgba(15,23,42,.07)" }}><b>{text(item.title, `Proof item ${index + 1}`)}</b><p style={{ color: "var(--senuke-muted)", lineHeight: 1.65 }}>{text(item.description)}</p></article>)}</div></SectionShell>;
  if (componentId === "content.faq") return <SectionShell className={`senuke-faq-section ${alignmentClass}`}><div><h2 style={{ fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(30px,4vw,46px)" }}>{heading || "Frequently asked questions"}</h2><div style={{ display: "grid", gap: 12, marginTop: 24 }}>{items.map((item, index) => <details key={index} open={index === 0} style={{ border: "1px solid #e2e8f0", borderRadius: "var(--senuke-radius)", padding: 20 }}><summary style={{ cursor: "pointer", fontWeight: 900 }}>{text(item.question || item.title, `Question ${index + 1}`)}</summary><p style={{ color: "var(--senuke-muted)", lineHeight: 1.7 }}>{text(item.answer || item.description)}</p></details>)}</div></div></SectionShell>;
  if (componentId === "conversion.cta") return <section className={`senuke-cta-section ${alignmentClass}`} style={{ margin: "42px 5% 70px", padding: "clamp(38px, 6vw, 76px)", borderRadius: "calc(var(--senuke-radius) * 1.5)", background: "linear-gradient(135deg,var(--senuke-secondary),color-mix(in srgb,var(--senuke-secondary) 76%,var(--senuke-primary)))", color: "#fff" }}><h2 style={{ position: "relative", zIndex: 1, marginTop: 0, maxWidth: 760, fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(32px,4vw,50px)" }}>{heading || "Ready to take the next step?"}</h2><p style={{ position: "relative", zIndex: 1, maxWidth: 760, fontSize: 18, lineHeight: 1.7 }}>{text(props.body)}</p><WebsiteActionLink href={text(props.buttonUrl, "/contact/")} chrome={chrome} style={{ position: "relative", zIndex: 1, display: "inline-block", marginTop: 12, borderRadius: "var(--senuke-radius)", background: "var(--senuke-accent)", color: "var(--senuke-text)", padding: "14px 22px", fontWeight: 900, textDecoration: "none" }}>{text(props.buttonLabel, "Contact us")}</WebsiteActionLink></section>;
  if (componentId === "conversion.contact_form") return <SectionShell tone="soft" className={`senuke-contact-form-section ${alignmentClass}`}>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,.8fr) minmax(300px,1.2fr)", gap: "clamp(28px,6vw,76px)", alignItems: "start" }}>
      <div>
        <h2 style={{ marginTop: 0, fontFamily: "var(--senuke-heading-font)", fontSize: "clamp(30px,4vw,48px)" }}>{heading || "Contact us"}</h2>
        <p style={{ color: "var(--senuke-muted)", fontSize: 17, lineHeight: 1.75 }}>{text(props.introduction, "Tell us how we can help and our team will follow up.")}</p>
        {chrome?.contactEmail ? <p><a href={`mailto:${chrome.contactEmail}`} style={{ color: "var(--senuke-primary)", fontWeight: 800 }}>{chrome.contactEmail}</a></p> : null}
        {chrome?.contactPhone ? <p><a href={`tel:${chrome.contactPhone.replace(/[^\d+]/g, "")}`} style={{ color: "var(--senuke-primary)", fontWeight: 800 }}>{chrome.contactPhone}</a></p> : null}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }} style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, borderRadius: "calc(var(--senuke-radius) * 1.2)", background: "var(--senuke-surface)", padding: "clamp(22px,4vw,36px)", boxShadow: "0 20px 60px rgba(15,23,42,.1)" }}>
        {contactFields.map((field, index) => {
          const label = text(field.label || field.title, `Field ${index + 1}`);
          const name = text(field.name, label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
          const type = text(field.inputType || field.type, /email/i.test(name) ? "email" : /phone|tel/i.test(name) ? "tel" : /message|details/i.test(name) ? "textarea" : "text");
          const required = field.required === true;
          if (type === "checkbox") return <label key={index} style={{ gridColumn: "1 / -1", display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.5 }}><input name={name} type="checkbox" required={required} style={{ marginTop: 3 }}/><span>{label}</span></label>;
          return <label key={index} style={{ display: "grid", gridColumn: type === "textarea" ? "1 / -1" : undefined, gap: 7, color: "var(--senuke-text)", fontSize: 13, fontWeight: 800 }}><span>{label}{required ? " *" : ""}</span>{type === "textarea" ? <textarea name={name} required={required} rows={5} style={{ width: "100%", resize: "vertical", border: "1px solid #cbd5e1", borderRadius: "var(--senuke-radius)", background: "var(--senuke-background)", padding: 12, font: "inherit" }}/> : <input name={name} type={["email", "tel"].includes(type) ? type : "text"} required={required} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: "var(--senuke-radius)", background: "var(--senuke-background)", padding: 12, font: "inherit" }}/>}</label>;
        })}
        <button type="submit" style={{ gridColumn: "1 / -1", border: 0, borderRadius: "var(--senuke-radius)", background: "var(--senuke-primary)", color: "#fff", padding: "14px 20px", fontWeight: 900, cursor: "pointer" }}>{text(props.submitLabel, "Send enquiry")}</button>
        {submitted ? <div role="status" style={{ gridColumn: "1 / -1", borderRadius: 10, background: "#ecfdf5", padding: 12, color: "#047857", fontSize: 13, fontWeight: 800 }}>{text(props.successMessage, "Thank you. Your enquiry is ready to be sent when the website is published.")}</div> : null}
      </form>
    </div>
  </SectionShell>;
  if (componentId === "global.footer") return <footer style={{ padding: "42px 7%", background: "var(--senuke-text)", color: "#fff" }}><b style={{ fontSize: 20 }}>{text(props.businessName, "Business name")}</b><p style={{ maxWidth: 700, color: "#cbd5e1", lineHeight: 1.65 }}>{text(props.summary)}</p></footer>;
  return <SectionShell><b>Unsupported preview component: {componentId}</b></SectionShell>;
}

export function createSenukePuckConfig(theme: Theme = {}, mediaAssets: VisualMediaAsset[] = [], chrome?: WebsiteChrome): Config<any> {
  const components: Record<string, unknown> = {};
  for (const definition of SENUKE_COMPONENT_REGISTRY_V1.components.filter((item) => item.lifecycleStatus === "active")) {
    const fields: Record<string, unknown> = {
      variant: {
        type: "select",
        label: "Layout variant",
        options: definition.variants.map((variant) => ({ label: friendlyName(variant), value: variant })),
      },
    };
    for (const [fieldName, fieldDefinition] of Object.entries(definition.fields)) fields[fieldName] = registryField(fieldName, fieldDefinition, mediaAssets, definition.allowedChildren);
    components[definition.componentId] = {
      label: definition.componentId === "layout.section" ? "Add section / columns" : friendlyName(definition.componentId),
      fields,
      defaultProps: {
        variant: definition.variants[0],
        ...Object.fromEntries(Object.entries(definition.fields).map(([name, field]) => [name,
          name === "alignment" ? "left"
            : name === "headingSize" ? "medium"
              : name === "headingWeight" ? "bold"
                : name === "headingColor" || name === "backgroundColor" ? "default"
                  : name === "textColor" ? "auto"
                    : name === "spacing" ? "comfortable"
                      : name === "backgroundOverlay" ? 40
                        : field.type === "object_list" || field.type === "string_list" || field.type === "component_slot" ? []
                          : field.type === "boolean" ? false
                            : field.type === "number" ? 0 : ""])),
      },
      ...(definition.componentId === "layout.section" ? {
        resolveData: (data: { props?: PuckProps }, params: { changed?: Record<string, boolean> }) => {
          if (!params.changed?.variant) return data;
          const props = data.props || {};
          const count = props.variant === "one_column" ? 1 : props.variant === "three_equal" ? 3 : 2;
          const one = Array.isArray(props.columnOne) ? props.columnOne : [];
          const two = Array.isArray(props.columnTwo) ? props.columnTwo : [];
          const three = Array.isArray(props.columnThree) ? props.columnThree : [];
          if (count === 1) return { ...data, props: { ...props, columnOne: [...one, ...two, ...three], columnTwo: [], columnThree: [] } };
          if (count === 2) return { ...data, props: { ...props, columnOne: one, columnTwo: [...two, ...three], columnThree: [] } };
          return data;
        },
      } : {}),
      permissions: { drag: true, duplicate: true, delete: true, edit: true, insert: true },
      render: (props: PuckProps) => <RegisteredComponent componentId={definition.componentId} props={props} mediaAssets={mediaAssets} chrome={chrome} />,
    };
  }
  return {
    components: components as Config<any>["components"],
    root: {
      render: ({ children }: { children: React.ReactNode }) => <div className="senuke-site-canvas" data-preview-viewport={chrome?.previewMode} style={themeVariables(theme)}><style>{VISUAL_EDITOR_CSS}</style>{chrome ? <GlobalWebsiteHeader chrome={chrome}/> : null}{children}{chrome ? <GlobalWebsiteFooter chrome={chrome}/> : null}</div>,
    },
    categories: {
      layout: { title: "Sections & columns", components: ["layout.section"] },
      hero: { title: "Hero", components: ["hero.local_service"] },
      services: { title: "Services", components: ["service.grid", "service.benefits"] },
      content: { title: "Content", components: ["content.rich_text", "content.process", "content.faq"] },
      media: { title: "Images", components: ["media.image"] },
      trust: { title: "Trust", components: ["trust.proof"] },
      conversion: { title: "Conversion", components: ["conversion.cta", "conversion.contact_form"] },
      global: { title: "Global", components: ["global.header", "global.footer"] },
    },
  };
}

export function websiteComponentsToPuck(instances: WebsiteComponentInstance[]): Data<Record<string, PuckProps>> {
  const toPuckItem = (instance: WebsiteComponentInstance): { type: string; props: PuckProps } => {
    const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find((candidate) => candidate.componentId === instance.componentId && candidate.lifecycleStatus === "active");
    if (!definition) throw new Error(`${instance.componentId} is not an approved SENuke component.`);
    const props: PuckProps = {
      id: instance.instanceId,
      variant: instance.variant,
      __componentVersion: instance.componentVersion,
    };
    for (const [fieldName, fieldDefinition] of Object.entries(definition.fields)) {
      const value = instance.props[fieldName];
      if (fieldDefinition.type === "component_slot") {
        props[fieldName] = Array.isArray(value)
          ? value.map((entry) => toPuckItem(entry as unknown as WebsiteComponentInstance))
          : [];
      } else if (value !== undefined) props[fieldName] = value;
    }
    return { type: instance.componentId, props };
  };
  return {
    content: instances.map(toPuckItem),
    root: {},
  } as Data<Record<string, PuckProps>>;
}

const cleanItem = (value: Record<string, unknown>): Record<string, JsonValue> => Object.fromEntries(
  Object.entries(value)
    .filter(([, item]) => item !== "" && item !== null && item !== undefined)
    .map(([key, item]) => [key, item as JsonValue]),
);

export function puckToWebsiteComponents(data: Data<Record<string, PuckProps>>): WebsiteComponentInstance[] {
  const fromPuckItem = (item: { type?: string; props?: PuckProps }, index: number): WebsiteComponentInstance => {
    const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find((candidate) => candidate.componentId === item.type && candidate.lifecycleStatus === "active");
    if (!definition) throw new Error(`${String(item.type)} is not an approved SENuke component.`);
    const raw = (item.props || {}) as PuckProps;
    const props: Record<string, JsonValue> = {};
    for (const [fieldName, fieldDefinition] of Object.entries(definition.fields)) {
      const value = raw[fieldName];
      if (fieldDefinition.type === "object_list") props[fieldName] = list(value).map(cleanItem);
      else if (fieldDefinition.type === "string_list") props[fieldName] = Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? entry : text((entry as Record<string, unknown>).value)).filter(Boolean) : [];
      else if (fieldDefinition.type === "component_slot") props[fieldName] = (Array.isArray(value) ? value : []).map((entry, childIndex) => fromPuckItem(entry as { type?: string; props?: PuckProps }, childIndex)) as unknown as JsonValue;
      else if (value !== undefined && value !== null) props[fieldName] = value as JsonValue;
    }
    return {
      instanceId: text(raw.id, `${String(item.type)}-${index + 1}`),
      componentId: String(item.type),
      componentVersion: definition.version,
      variant: definition.variants.includes(String(raw.variant)) ? String(raw.variant) : definition.variants[0],
      props,
    };
  };
  const result: WebsiteComponentInstance[] = [];
  for (const [index, item] of data.content.entries()) {
    const instance = fromPuckItem(item as { type?: string; props?: PuckProps }, index);
    const findings = validateComponentInstance(instance);
    if (findings.length) throw new Error(findings.map((finding) => finding.message).join(" "));
    result.push(instance);
  }
  if (!result.length) throw new Error("Keep at least one approved component on the page.");
  return result;
}

export function themeVariables(theme: Theme): React.CSSProperties {
  return {
    "--senuke-primary": theme.primary || "#2563eb",
    "--senuke-secondary": theme.secondary || "#0f766e",
    "--senuke-accent": theme.accent || "#f59e0b",
    "--senuke-background": theme.background || "#f8fafc",
    "--senuke-surface": theme.surface || "#ffffff",
    "--senuke-text": theme.text || "#0f172a",
    "--senuke-muted": theme.mutedText || "#475569",
    "--senuke-heading-font": theme.headingFont || "Inter",
    "--senuke-body-font": theme.bodyFont || "Inter",
    "--senuke-radius": theme.radius || "14px",
    fontFamily: `${theme.bodyFont || "Inter"}, Arial, sans-serif`,
    color: theme.text || "#0f172a",
    background: theme.background || "#f8fafc",
  } as React.CSSProperties;
}
