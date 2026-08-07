import {
  SENUKE_COMPONENT_REGISTRY_V1,
  flattenWebsiteComponents,
  validateComponentInstance,
  type JsonValue,
  type WebsiteComponentInstance,
  type WebsiteModel,
  type WebsitePageModel,
} from "./websiteModel.js";

export type WebsiteRenderFile = {
  path: string;
  content: string;
  mimeType: string;
  base64?: boolean;
};

export type WebsiteRenderOptions = {
  approvedReleaseId?: string;
  snapshotHash?: string;
  baseUrl?: string;
  stylesheetHref?: string;
  formShortcode?: string;
  mediaAssets?: WebsiteModel["mediaAssets"];
  assetUrls?: Record<string, string>;
  internalUrlMap?: Record<string, string>;
  formAction?: string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const propString = (component: WebsiteComponentInstance, name: string) => {
  const value = component.props[name];
  return typeof value === "string" ? value : "";
};

const propObjects = (component: WebsiteComponentInstance, name: string) => {
  const value = component.props[name];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, JsonValue> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
};

const propComponents = (component: WebsiteComponentInstance, name: string): WebsiteComponentInstance[] => {
  const value = component.props[name];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is WebsiteComponentInstance => Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof (item as Record<string, JsonValue>).componentId === "string"
    && typeof (item as Record<string, JsonValue>).instanceId === "string",
  ));
};

const componentAlignmentClass = (component: WebsiteComponentInstance) => {
  const value = propString(component, "alignment");
  const size = propString(component, "headingSize");
  const weight = propString(component, "headingWeight");
  const color = propString(component, "headingColor");
  return [
    ["left", "center", "right"].includes(value) ? `senuke-align-${value}` : "",
    ["small", "medium", "large"].includes(size) ? `senuke-heading-${size}` : "",
    ["regular", "semibold", "bold", "black"].includes(weight) ? `senuke-heading-${weight}` : "",
    ["primary", "secondary", "accent", "text"].includes(color) ? `senuke-heading-color-${color}` : "",
  ].filter(Boolean).join(" ");
};

const itemText = (item: Record<string, JsonValue>, ...keys: string[]) => {
  for (const key of keys) if (typeof item[key] === "string") return String(item[key]);
  return "";
};

const paragraphs = (value: string) =>
  value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

const safeJsonLd = (value: Record<string, JsonValue>) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const normalizedPath = (slug: string) => {
  const path = slug.replace(/^\/+|\/+$/g, "");
  return path ? `/${path}/` : "/";
};

const resolvedComponentUrl = (value: string, options: WebsiteRenderOptions) => {
  const path = /^(?:https?:\/\/|mailto:|tel:|#)/i.test(value) ? "" : normalizedPath(value);
  return path && options.internalUrlMap?.[path] ? options.internalUrlMap[path] : value;
};

const renderableImageUrl = (value: string) =>
  /^https:\/\//i.test(value)
  || /^data:image\//i.test(value)
  || /^(?:\/assets\/|(?:\.\.\/)*assets\/)/i.test(value);

const pageById = (model: WebsiteModel, pageId: string) =>
  model.pages.find((page) => page.pageId === pageId);

const activeInternalLinks = (page: WebsitePageModel) =>
  page.seo.internalLinks.filter((link) => !["removed", "blocked_by_validation", "draft"].includes(link.status ?? "approved"));

const internalLinkHref = (model: WebsiteModel, targetPageId: string, options: WebsiteRenderOptions) => {
  const target = pageById(model, targetPageId);
  if (!target) return "";
  const path = normalizedPath(target.slug);
  return options.internalUrlMap?.[path] || path;
};

const renderInternalLinkList = (
  model: WebsiteModel,
  page: WebsitePageModel,
  placements: string[],
  options: WebsiteRenderOptions,
  className: string,
  label: string,
) => {
  const links = activeInternalLinks(page).filter((link) => placements.includes(link.placement ?? "body"));
  if (!links.length) return "";
  return `<nav class="${className}" aria-label="${escapeHtml(label)}"><ul>${links.map((link) => {
    const href = internalLinkHref(model, link.targetPageId, options);
    return href ? `<li><a href="${escapeHtml(href)}">${escapeHtml(link.anchorText)}</a></li>` : "";
  }).join("")}</ul></nav>`;
};

const breadcrumbHtml = (model: WebsiteModel, page: WebsitePageModel, options: WebsiteRenderOptions) => {
  const saved = model.navigationModel?.breadcrumbs.find((item) => item.pageId === page.pageId)?.path
    ?? page.breadcrumbPath
    ?? [];
  const path = saved.length > 1 ? saved : [];
  if (!path.length) return "";
  return `<nav class="senuke-breadcrumbs" aria-label="Breadcrumb"><ol>${path.map((pageId, index) => {
    const item = pageById(model, pageId);
    if (!item) return "";
    const current = index === path.length - 1;
    const label = item.breadcrumbLabel || item.navLabel || item.name;
    const href = internalLinkHref(model, item.pageId, options);
    return current ? `<li aria-current="page">${escapeHtml(label)}</li>` : `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
  }).join("")}</ol></nav>`;
};

const renderCardItems = (component: WebsiteComponentInstance, className: string) =>
  propObjects(component, "items")
    .map((item) => {
      const title = itemText(item, "title", "name", "label");
      const description = itemText(item, "description", "body", "text");
      return `<article class="${className}">${title ? `<h3>${escapeHtml(title)}</h3>` : ""}${description ? `<p>${escapeHtml(description)}</p>` : ""}</article>`;
    })
    .join("");

const managedFormAttributes = (options: WebsiteRenderOptions, formId: string) =>
  `method="post"${options.formAction ? ` action="${escapeHtml(options.formAction)}" data-senuke-managed-form` : ""} data-senuke-form-id="${escapeHtml(formId)}"`;

const formHoneypot = () =>
  `<label class="senuke-visually-hidden" aria-hidden="true">Company website<input type="text" name="_senuke_company_website" tabindex="-1" autocomplete="off"></label>`;

/**
 * Render one registry-approved component. The renderer never accepts arbitrary
 * HTML or code from the Website Model.
 */
export function renderWebsiteComponentHtml(
  component: WebsiteComponentInstance,
  options: WebsiteRenderOptions = {},
) {
  const findings = validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1);
  if (findings.some((finding) => finding.severity === "blocking")) {
    throw new Error(`Unsupported website component ${component.componentId}@${component.componentVersion}.`);
  }
  const heading = escapeHtml(propString(component, "heading"));
  const alignmentClass = componentAlignmentClass(component);
  switch (component.componentId) {
    case "layout.section":
      {
        const variant = ["one_column", "two_equal", "two_left_wide", "two_right_wide", "three_equal"].includes(component.variant) ? component.variant : "two_equal";
        const count = variant === "one_column" ? 1 : variant === "three_equal" ? 3 : 2;
        const background = ["default", "background", "surface", "primary", "secondary", "accent", "dark"].includes(propString(component, "backgroundColor")) ? propString(component, "backgroundColor") : "default";
        const textColor = ["auto", "text", "muted", "white"].includes(propString(component, "textColor")) ? propString(component, "textColor") : "auto";
        const spacing = ["compact", "comfortable", "spacious"].includes(propString(component, "spacing")) ? propString(component, "spacing") : "comfortable";
        const assetId = propString(component, "backgroundImageAssetId");
        const asset = options.mediaAssets?.find((candidate) => candidate.assetId === assetId);
        const imageUrl = options.assetUrls?.[assetId] || asset?.sourceUrl || "";
        const image = assetId && renderableImageUrl(imageUrl) ? `<img class="senuke-layout-background-image" src="${escapeHtml(imageUrl)}" alt="" aria-hidden="true">` : "";
        const rawOverlay = component.props.backgroundOverlay;
        const overlay = typeof rawOverlay === "number" ? Math.max(0, Math.min(90, rawOverlay)) : 40;
        const overlayHtml = image && overlay ? `<span class="senuke-layout-background-overlay" style="opacity:${overlay / 100}"></span>` : "";
        const slotNames = ["columnOne", "columnTwo", "columnThree"].slice(0, count);
        const columns = slotNames.map((slotName, index) => `<div class="senuke-layout-column" data-column="${index + 1}">${propComponents(component, slotName).map((child) => renderWebsiteComponentHtml(child, options)).join("")}</div>`).join("");
        return `<section class="senuke-component senuke-layout-section senuke-layout-${escapeHtml(variant)} senuke-layout-bg-${escapeHtml(background)} senuke-layout-text-${escapeHtml(textColor)} senuke-layout-spacing-${escapeHtml(spacing)}">${image}${overlayHtml}<div class="senuke-layout-columns">${columns}</div></section>`;
      }
    case "global.header":
      return `<header class="senuke-component senuke-header"><strong>${escapeHtml(propString(component, "businessName"))}</strong>${propString(component, "primaryCtaLabel") ? `<a class="senuke-button" href="${escapeHtml(resolvedComponentUrl(propString(component, "primaryCtaUrl"), options))}">${escapeHtml(propString(component, "primaryCtaLabel"))}</a>` : ""}</header>`;
    case "hero.local_service":
      {
        const assetId = propString(component, "imageAssetId");
        const asset = options.mediaAssets?.find((candidate) => candidate.assetId === assetId);
        const imageUrl = options.assetUrls?.[assetId] || asset?.sourceUrl || "";
        const image = assetId && renderableImageUrl(imageUrl)
          ? `<img class="senuke-hero-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(asset?.altText || propString(component, "headline"))}">`
          : "";
        return `<section class="senuke-component senuke-hero senuke-${escapeHtml(component.variant)} ${alignmentClass}"><div>${propString(component, "eyebrow") ? `<p class="senuke-eyebrow">${escapeHtml(propString(component, "eyebrow"))}</p>` : ""}<h1>${escapeHtml(propString(component, "headline"))}</h1><p class="senuke-lead">${escapeHtml(propString(component, "summary"))}</p><a class="senuke-button" href="${escapeHtml(resolvedComponentUrl(propString(component, "primaryCtaUrl"), options))}">${escapeHtml(propString(component, "primaryCtaLabel"))}</a></div>${image}</section>`;
      }
    case "content.rich_text":
      return `<section class="senuke-component senuke-rich-text ${alignmentClass}"><h2>${heading}</h2>${paragraphs(propString(component, "body"))}</section>`;
    case "media.image":
      {
        const assetId = propString(component, "imageAssetId");
        const asset = options.mediaAssets?.find((candidate) => candidate.assetId === assetId);
        const imageUrl = options.assetUrls?.[assetId] || asset?.sourceUrl || "";
        const image = assetId && renderableImageUrl(imageUrl)
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(propString(component, "altText") || asset?.altText || "")}">`
          : "";
        return `<figure class="senuke-component senuke-media senuke-media-${escapeHtml(component.variant)}">${image}${propString(component, "caption") ? `<figcaption>${escapeHtml(propString(component, "caption"))}</figcaption>` : ""}</figure>`;
      }
    case "service.grid":
      return `<section class="senuke-component senuke-services senuke-services-${escapeHtml(component.variant)} ${alignmentClass}"><h2>${heading}</h2>${propString(component, "introduction") ? `<p>${escapeHtml(propString(component, "introduction"))}</p>` : ""}<div class="senuke-grid">${renderCardItems(component, "senuke-card")}</div></section>`;
    case "service.benefits":
      return `<section class="senuke-component senuke-benefits senuke-benefits-${escapeHtml(component.variant)} ${alignmentClass}"><h2>${heading}</h2><div class="senuke-grid">${renderCardItems(component, "senuke-card senuke-benefit")}</div></section>`;
    case "content.process":
      return `<section class="senuke-component senuke-process senuke-process-${escapeHtml(component.variant)} ${alignmentClass}"><h2>${heading}</h2><ol class="senuke-steps">${propObjects(component, "steps").map((item) => `<li><h3>${escapeHtml(itemText(item, "title", "name"))}</h3><p>${escapeHtml(itemText(item, "description", "body", "text"))}</p></li>`).join("")}</ol></section>`;
    case "trust.proof":
      return `<section class="senuke-component senuke-proof ${alignmentClass}"><h2>${heading}</h2>${propString(component, "introduction") ? `<p>${escapeHtml(propString(component, "introduction"))}</p>` : ""}<div class="senuke-grid">${renderCardItems(component, "senuke-card")}</div></section>`;
    case "content.faq":
      return `<section class="senuke-component senuke-faq ${alignmentClass}"><h2>${heading}</h2>${propObjects(component, "items").map((item) => `<details><summary>${escapeHtml(itemText(item, "question", "title"))}</summary><p>${escapeHtml(itemText(item, "answer", "description", "body"))}</p></details>`).join("")}</section>`;
    case "conversion.cta":
      return `<section class="senuke-component senuke-cta ${alignmentClass}"><h2>${heading}</h2><p>${escapeHtml(propString(component, "body"))}</p><a class="senuke-button" href="${escapeHtml(resolvedComponentUrl(propString(component, "buttonUrl"), options))}">${escapeHtml(propString(component, "buttonLabel"))}</a></section>`;
    case "conversion.contact_form":
      {
        if (options.formShortcode) {
          return `<section class="senuke-component senuke-contact-form senuke-contact-form-shortcode ${alignmentClass}"><div><h2>${heading}</h2><p>${escapeHtml(propString(component, "introduction"))}</p></div><div>${options.formShortcode}</div></section>`;
        }
        const fields = propObjects(component, "fields");
        const controls = fields.map((field) => {
          const label = itemText(field, "label", "title") || "Contact detail";
          const name = itemText(field, "name") || label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const type = itemText(field, "inputType", "type").toLowerCase();
          const required = field.required === true;
          if (type === "textarea" || /message|details|question/i.test(name)) {
            return `<label>${escapeHtml(label)}<textarea name="${escapeHtml(name)}"${required ? " required" : ""} rows="5"></textarea></label>`;
          }
          if (type === "checkbox" || /consent/i.test(name)) {
            return `<label class="senuke-form-consent"><input type="checkbox" name="${escapeHtml(name)}"${required ? " required" : ""}> <span>${escapeHtml(label)}</span></label>`;
          }
          const inputType = ["email", "tel", "text"].includes(type) ? type : /email/i.test(name) ? "email" : /phone|tel/i.test(name) ? "tel" : "text";
          return `<label>${escapeHtml(label)}<input type="${inputType}" name="${escapeHtml(name)}"${required ? " required" : ""}></label>`;
        }).join("");
        return `<section class="senuke-component senuke-contact-form ${alignmentClass}"><div><h2>${heading}</h2><p>${escapeHtml(propString(component, "introduction"))}</p></div><form ${managedFormAttributes(options, propString(component, "formId"))}>${formHoneypot()}${controls}<button class="senuke-button" type="submit">${escapeHtml(propString(component, "submitLabel"))}</button><p class="senuke-form-status" role="status" aria-live="polite" hidden>${escapeHtml(propString(component, "successMessage"))}</p></form></section>`;
      }
    case "global.footer":
      return `<footer class="senuke-component senuke-footer"><strong>${escapeHtml(propString(component, "businessName"))}</strong>${propString(component, "summary") ? `<p>${escapeHtml(propString(component, "summary"))}</p>` : ""}</footer>`;
    default:
      throw new Error(`No approved renderer is mapped for ${component.componentId}.`);
  }
}

export function renderWebsitePageBodyHtml(
  model: WebsiteModel,
  page: WebsitePageModel,
  options: WebsiteRenderOptions = {},
) {
  const contactPage = model.pages.find((candidate) => candidate.pageType === "contact" || candidate.pageType === "conversion" || /\b(contact|get in touch|request a quote)\b/i.test(candidate.name));
  const contactPath = contactPage ? normalizedPath(contactPage.slug) : "";
  const internalUrlMap = {
    ...Object.fromEntries(model.pages.map((candidate) => [normalizedPath(candidate.slug), normalizedPath(candidate.slug)])),
    ...(contactPage ? { "/contact/": options.internalUrlMap?.[contactPath] || contactPath } : {}),
    ...options.internalUrlMap,
  };
  const componentOptions = { ...options, internalUrlMap };
  const heroIndex = page.sections.findIndex((component) => component.componentId === "hero.local_service");
  const secondFoldIndex = page.sections.findIndex((component, index) => index > heroIndex && Boolean(propString(component, "heading")));
  const renderedSections = page.sections.map((component, index) => {
    const html = renderWebsiteComponentHtml(component, componentOptions);
    return index === secondFoldIndex
      ? html.replace('class="senuke-component ', 'class="senuke-component senuke-second-fold ')
      : html;
  });
  const introLinks = renderInternalLinkList(model, page, ["body_intro", "body"], componentOptions, "senuke-contextual-links senuke-intro-links", "Related information");
  const sections = renderedSections.length
    ? `${renderedSections[0]}${introLinks}${renderedSections.slice(1).join("")}`
    : introLinks;
  const relatedLinks = renderInternalLinkList(model, page, ["related_pages", "service_area", "faq", "card"], componentOptions, "senuke-related-pages", pageIsLocalRender(page) ? "Related service areas" : "Related pages");
  const conversionLinks = renderInternalLinkList(model, page, ["cta"], componentOptions, "senuke-link-cta", "Next step");
  const form = model.forms[0];
  const hasRegisteredForm = flattenWebsiteComponents(page.sections).some((section) => section.componentId === "conversion.contact_form");
  const isContactPage = page.pageType === "contact"
    || page.pageType === "conversion"
    || /\b(contact|get in touch|enquir|request (?:a )?quote)\b/i.test(`${page.name} ${page.slug}`);
  const formHtml = isContactPage && form && !hasRegisteredForm
    ? options.formShortcode || `<section class="senuke-component senuke-contact-form"><div><h2>Contact us</h2><p>Tell us how we can help and the team will follow up using the contact details you provide.</p></div><form ${managedFormAttributes(options, form.formId)}>${formHoneypot()}${form.fields.map((field) => {
        const name = field.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field";
        const required = /name|email|message|details|consent/i.test(field);
        if (/message|details|question/i.test(field)) return `<label>${escapeHtml(field)}<textarea name="${escapeHtml(name)}"${required ? " required" : ""} rows="5"></textarea></label>`;
        if (/consent/i.test(field)) return `<label class="senuke-form-consent"><input type="checkbox" name="${escapeHtml(name)}"${required ? " required" : ""}> <span>${escapeHtml(field)}</span></label>`;
        const type = /email/i.test(field) ? "email" : /phone|tel/i.test(field) ? "tel" : "text";
        return `<label>${escapeHtml(field)}<input type="${type}" name="${escapeHtml(name)}"${required ? " required" : ""}></label>`;
      }).join("")}<button class="senuke-button" type="submit">Send enquiry</button><p class="senuke-form-status" role="status" aria-live="polite" hidden></p></form></section>`
    : "";
  return `${breadcrumbHtml(model, page, componentOptions)}${sections}${relatedLinks}${conversionLinks}${formHtml}`;
}

const pageIsLocalRender = (page: WebsitePageModel) =>
  Boolean(page.seo.location?.city || page.seo.location?.province || page.seo.location?.country || page.seo.location?.market)
  || /(?:local|location|city|province|service.area)/i.test(`${page.pageType} ${page.seo.dominantIntent}`);

const navigationHtml = (model: WebsiteModel, options: WebsiteRenderOptions = {}) => {
  const navigation = model.navigationModel?.primaryMenu ?? model.navigation;
  const items = navigation.filter((item) => !item.parentPageId);
  const nested = (item: WebsiteModel["navigation"][number], visited = new Set<string>()): string => {
    if (visited.has(item.pageId)) return "";
    const page = pageById(model, item.pageId);
    if (!page && !item.custom) return "";
    const nextVisited = new Set(visited).add(item.pageId);
    const children = navigation.filter((candidate) => candidate.parentPageId === item.pageId);
    const path = page ? normalizedPath(page.slug) : item.url || "";
    const destination = page
      ? options.internalUrlMap?.[path] || path
      : resolvedComponentUrl(path, options);
    const label = destination
      ? `<a href="${escapeHtml(destination)}">${escapeHtml(item.label)}</a>`
      : `<span>${escapeHtml(item.label)}</span>`;
    return `<li>${label}${children.length ? `<ul>${children.map((child) => nested(child, nextVisited)).join("")}</ul>` : ""}</li>`;
  };
  return `<nav aria-label="Primary navigation"><ul>${items.map((item) => nested(item)).join("")}</ul></nav>`;
};

const utilityNavigationHtml = (model: WebsiteModel, options: WebsiteRenderOptions = {}) => {
  const items = model.navigationModel?.utilityMenu ?? [];
  if (!items.length) return "";
  return `<nav class="senuke-utility-nav" aria-label="Utility navigation"><ul>${items.map((item) => {
    const page = pageById(model, item.pageId);
    const path = page ? normalizedPath(page.slug) : item.url || "";
    const href = page ? options.internalUrlMap?.[path] || path : resolvedComponentUrl(path, options);
    return href ? `<li><a href="${escapeHtml(href)}">${escapeHtml(item.label)}</a></li>` : "";
  }).join("")}</ul></nav>`;
};

const footerNavigationHtml = (model: WebsiteModel, options: WebsiteRenderOptions = {}) => {
  const sourceGroups = model.navigationModel?.footerMenus ?? [];
  const groups = [...sourceGroups.reduce((merged, group) => {
    const key = group.label.trim().toLowerCase();
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...group, items: [...group.items] });
      return merged;
    }
    const existingPageIds = new Set(current.items.map((item) => item.pageId));
    current.items.push(...group.items.filter((item) => !existingPageIds.has(item.pageId)));
    return merged;
  }, new Map<string, (typeof sourceGroups)[number]>()).values()];
  if (!groups.length) return "";
  const labelCounts = new Map<string, number>();
  for (const item of groups.flatMap((group) => group.items)) {
    const key = item.label.trim().toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  return `<nav class="senuke-footer-navigation" aria-label="Footer navigation">${groups.map((group) => `<section><h2>${escapeHtml(group.label)}</h2><ul>${group.items.map((item) => {
    const page = pageById(model, item.pageId);
    const path = page ? normalizedPath(page.slug) : item.url || "";
    const href = page ? options.internalUrlMap?.[path] || path : resolvedComponentUrl(path, options);
    const label = page && (labelCounts.get(item.label.trim().toLowerCase()) ?? 0) > 1 ? page.name : item.label;
    return href ? `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>` : "";
  }).join("")}</ul></section>`).join("")}</nav>`;
};

const socialProfileMeta = {
  facebook: { label: "Facebook", icon: '<path class="senuke-social-fill" d="M14.2 8.2h2.6V4.4c-.4-.1-2-.2-3.6-.2-3.5 0-5.9 2.1-5.9 6.1v3.4H3.4V18h3.9v10h4.8V18h4l.6-4.3h-4.6v-3c0-1.3.4-2.5 2.1-2.5Z"/>' },
  instagram: { label: "Instagram", icon: '<rect x="5" y="5" width="22" height="22" rx="6"/><circle cx="16" cy="16" r="5"/><circle cx="23.5" cy="8.5" r="1.4" class="senuke-social-fill"/>' },
  linkedin: { label: "LinkedIn", icon: '<rect class="senuke-social-fill" x="5" y="12" width="4.5" height="15"/><circle cx="7.25" cy="7.5" r="2.5" class="senuke-social-fill"/><path class="senuke-social-fill" d="M14 27V12h4.4v2.1c1.1-1.6 2.8-2.7 5.4-2.7 4.6 0 5.7 3 5.7 7V27H25v-7.6c0-2.2-.4-4.2-3.1-4.2-2.8 0-3.4 2.2-3.4 4.1V27Z"/>' },
  youtube: { label: "YouTube", icon: '<rect x="3" y="7" width="26" height="18" rx="6"/><path d="m13 12 8 4-8 4Z" class="senuke-social-fill"/>' },
  x: { label: "X", icon: '<path class="senuke-social-fill" d="M6 5h6.2l4.9 6.5L22.7 5H26l-7.4 8.8L27 27h-6.2l-5.5-7.3L9 27H5.7l8.1-9.7Z"/>' },
  tiktok: { label: "TikTok", icon: '<path class="senuke-social-fill" d="M19 4c.5 3.2 2.3 5.1 5.5 5.8v4.1a11 11 0 0 1-5.5-1.7v7.6A8.2 8.2 0 1 1 12 11.7v4.4a3.9 3.9 0 1 0 2.7 3.7V4Z"/>' },
} as const;

const socialNavigationHtml = (model: WebsiteModel) => {
  const profiles = (model.identity?.socialProfiles ?? []).filter((profile) => /^https:\/\//i.test(profile.url) && socialProfileMeta[profile.network]);
  if (!profiles.length) return "";
  return `<nav class="senuke-social-links" aria-label="Social media">${profiles.map((profile) => {
    const meta = socialProfileMeta[profile.network];
    return `<a href="${escapeHtml(profile.url)}" target="_blank" rel="noopener noreferrer" aria-label="${meta.label}" title="${meta.label}"><svg viewBox="0 0 32 32" aria-hidden="true">${meta.icon}</svg></a>`;
  }).join("")}</nav>`;
};

export function renderWebsitePageDocument(
  model: WebsiteModel,
  page: WebsitePageModel,
  options: WebsiteRenderOptions = {},
) {
  const colors = model.designSystem.colors;
  const canonical = /^https:\/\//i.test(page.seo.canonicalUrl)
    ? page.seo.canonicalUrl
    : options.baseUrl
      ? `${options.baseUrl.replace(/\/+$/, "")}${normalizedPath(page.seo.canonicalUrl || page.slug)}`
      : normalizedPath(page.seo.canonicalUrl || page.slug);
  const cssVariables = `--senuke-primary:${escapeHtml(colors.primary)};--senuke-secondary:${escapeHtml(colors.secondary)};--senuke-accent:${escapeHtml(colors.accent)};--senuke-background:${escapeHtml(colors.background)};--senuke-surface:${escapeHtml(colors.surface)};--senuke-text:${escapeHtml(colors.text)};--senuke-muted:${escapeHtml(colors.mutedText)};--senuke-heading:${escapeHtml(model.designSystem.typography.headingFont)};--senuke-body:${escapeHtml(model.designSystem.typography.bodyFont)}`;
  const logoAssetId = model.identity?.logoAssetId || "";
  const logoAsset = model.mediaAssets.find((asset) => asset.assetId === logoAssetId);
  const logoUrl = options.assetUrls?.[logoAssetId] || logoAsset?.sourceUrl || "";
  const brandName = model.identity?.businessName || model.pages[0]?.name || "Website";
  const brandMarkup = logoUrl && renderableImageUrl(logoUrl)
    ? `<img class="senuke-brand-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(logoAsset?.altText || `${brandName} logo`)}">`
    : escapeHtml(brandName);
  const contactItems = [
    model.identity?.contactPhone ? `<a href="tel:${escapeHtml(model.identity.contactPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(model.identity.contactPhone)}</a>` : "",
    model.identity?.contactEmail ? `<a href="mailto:${escapeHtml(model.identity.contactEmail)}">${escapeHtml(model.identity.contactEmail)}</a>` : "",
    model.identity?.businessAddress ? `<span>${escapeHtml(model.identity.businessAddress)}</span>` : "",
  ].filter(Boolean);
  const copyrightText = model.identity?.copyrightText || `© ${new Date().getFullYear()} ${brandName}. All rights reserved.`;
  const homeHref = options.internalUrlMap?.["/"] || "/";
  const formDeliveryScript = options.formAction
    ? `<script>
document.querySelectorAll("[data-senuke-managed-form]").forEach(function(form){
  form.addEventListener("submit",async function(event){
    event.preventDefault();
    var button=form.querySelector('button[type="submit"]');
    var status=form.querySelector(".senuke-form-status");
    if(button)button.disabled=true;
    if(status){status.hidden=false;status.classList.remove("senuke-form-error");status.textContent="Sending…";}
    try{
      var payload={};
      new FormData(form).forEach(function(value,key){payload[key]=String(value);});
      var response=await fetch(form.action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      var result=await response.json().catch(function(){return {};});
      if(!response.ok)throw new Error(result.error||"We could not send your enquiry. Please try again.");
      form.reset();
      if(status)status.textContent=result.message||"Thank you. Your enquiry has been received.";
    }catch(error){
      if(status){status.classList.add("senuke-form-error");status.textContent=error instanceof Error?error.message:"We could not send your enquiry. Please try again.";}
    }finally{
      if(button)button.disabled=false;
    }
  });
});
</script>`
    : "";
  return `<!doctype html>
<html lang="en" style="${cssVariables}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.seo.title)}</title>
<meta name="description" content="${escapeHtml(page.seo.metaDescription)}">
<meta name="robots" content="${escapeHtml(page.seo.robots)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="stylesheet" href="${escapeHtml(options.stylesheetHref || "/assets/senuke.css")}">
<script type="application/ld+json">${safeJsonLd(page.seo.schemaJsonLd)}</script>
</head>
<body>
<header class="senuke-site-header"><a class="senuke-brand" href="${escapeHtml(homeHref)}">${brandMarkup}</a><div class="senuke-header-navigation">${utilityNavigationHtml(model, options)}${navigationHtml(model, options)}</div><details class="senuke-mobile-menu"><summary aria-label="Open navigation menu"><span class="senuke-menu-icon" aria-hidden="true"><i></i><i></i><i></i></span><span class="senuke-visually-hidden">Menu</span></summary><div class="senuke-mobile-menu-panel">${utilityNavigationHtml(model, options)}${navigationHtml(model, options)}</div></details></header>
<main>${renderWebsitePageBodyHtml(model, page, { ...options, mediaAssets: options.mediaAssets || model.mediaAssets })}</main>
<footer class="senuke-site-footer"><strong>${escapeHtml(brandName)}</strong>${contactItems.length ? `<div class="senuke-footer-contact">${contactItems.join("<span aria-hidden=\"true\"> · </span>")}</div>` : ""}${socialNavigationHtml(model)}${footerNavigationHtml(model, options)}<p class="senuke-footer-copyright">${escapeHtml(copyrightText)}</p></footer>
${formDeliveryScript}
</body>
</html>`;
}

export const SENUKE_STATIC_CSS = `
*{box-sizing:border-box}
body{margin:0;overflow-x:hidden;background:var(--senuke-background);color:var(--senuke-text);font-family:var(--senuke-body),system-ui,sans-serif;line-height:1.65}
h1,h2,h3{font-family:var(--senuke-heading),system-ui,sans-serif;line-height:1.15}
h1{max-width:18ch;font-size:clamp(2.2rem,6vw,4.8rem)}
.senuke-visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.senuke-site-header,.senuke-component,.senuke-breadcrumbs,.senuke-contextual-links,.senuke-related-pages,.senuke-link-cta{width:min(1120px,calc(100% - 2rem));margin-inline:auto}
.senuke-site-header{display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:1.25rem 0}
.senuke-header-navigation{display:grid;justify-items:end;gap:.35rem}
.senuke-mobile-menu{display:none}
.senuke-utility-nav{font-size:.78rem;color:var(--senuke-muted)}
.senuke-brand{display:flex;align-items:center;font-weight:900;color:var(--senuke-text);text-decoration:none}
.senuke-brand-logo{display:block;width:auto;max-width:190px;height:52px;object-fit:contain}
.senuke-site-header ul{display:flex;gap:1rem;list-style:none;margin:0;padding:0}
.senuke-site-header li{position:relative}
.senuke-site-header li ul{display:none;position:absolute;z-index:20;min-width:13rem;padding:1rem;background:var(--senuke-surface);box-shadow:0 16px 35px rgba(15,23,42,.14)}
.senuke-site-header li:hover>ul,.senuke-site-header li:focus-within>ul{display:grid}
.senuke-site-header a{color:inherit}
.senuke-site-header span{font-weight:700}
.senuke-breadcrumbs{padding-top:1rem}
.senuke-breadcrumbs ol{display:flex;flex-wrap:wrap;gap:.45rem;list-style:none;padding:0;color:var(--senuke-muted);font-size:.86rem}
.senuke-breadcrumbs li+li:before{content:"›";margin-right:.45rem}
.senuke-contextual-links,.senuke-related-pages{padding:1.1rem 0}
.senuke-contextual-links ul,.senuke-related-pages ul{display:flex;flex-wrap:wrap;gap:.7rem;list-style:none;padding:0}
.senuke-contextual-links a,.senuke-related-pages a{display:inline-flex;border-radius:999px;background:var(--senuke-surface);padding:.55rem .85rem;color:var(--senuke-primary);font-weight:750;text-decoration:none;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.senuke-link-cta{margin-block:2rem;padding:1.5rem;border-radius:1rem;background:var(--senuke-secondary)}
.senuke-link-cta ul{display:flex;flex-wrap:wrap;gap:.75rem;list-style:none;margin:0;padding:0}
.senuke-link-cta a{display:inline-flex;border-radius:.75rem;background:var(--senuke-accent);padding:.8rem 1rem;color:var(--senuke-text);font-weight:850;text-decoration:none}
.senuke-component{padding:clamp(3rem,7vw,7rem) 0}
.senuke-layout-section{position:relative;isolation:isolate;overflow:hidden;width:100%;max-width:none;padding-inline:max(1rem,calc((100% - 1120px)/2))}
.senuke-layout-background-image{position:absolute;z-index:-2;inset:0;width:100%;height:100%;object-fit:cover}
.senuke-layout-background-overlay{position:absolute;z-index:-1;inset:0;background:#020617}
.senuke-layout-columns{display:grid;gap:clamp(1.1rem,3vw,2.25rem);align-items:stretch}
.senuke-layout-one_column .senuke-layout-columns{grid-template-columns:minmax(0,1fr)}
.senuke-layout-two_equal .senuke-layout-columns{grid-template-columns:repeat(2,minmax(0,1fr))}
.senuke-layout-two_left_wide .senuke-layout-columns{grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr)}
.senuke-layout-two_right_wide .senuke-layout-columns{grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr)}
.senuke-layout-three_equal .senuke-layout-columns{grid-template-columns:repeat(3,minmax(0,1fr))}
.senuke-layout-column{min-width:0}
.senuke-layout-column>.senuke-component{width:100%;padding:clamp(1.25rem,3vw,2.5rem) 0;background:transparent}
.senuke-layout-column>.senuke-rich-text{text-align:inherit}.senuke-layout-column>.senuke-rich-text h2,.senuke-layout-column>.senuke-rich-text p{max-width:none;margin-left:0;margin-right:0;text-align:inherit}
.senuke-layout-column>.senuke-contact-form{grid-template-columns:1fr}.senuke-layout-column>.senuke-contact-form form{grid-template-columns:1fr}.senuke-layout-column>.senuke-contact-form form>*{grid-column:1}
.senuke-layout-column>.senuke-cta{margin:0;padding-inline:clamp(1.25rem,3vw,2.5rem)}
.senuke-layout-bg-default,.senuke-layout-bg-surface{background:var(--senuke-surface)}.senuke-layout-bg-background{background:var(--senuke-background)}.senuke-layout-bg-primary{background:var(--senuke-primary)}.senuke-layout-bg-secondary{background:var(--senuke-secondary)}.senuke-layout-bg-accent{background:var(--senuke-accent)}.senuke-layout-bg-dark{background:var(--senuke-text)}
.senuke-layout-text-text{color:var(--senuke-text)}.senuke-layout-text-muted{color:var(--senuke-muted)}.senuke-layout-text-white{color:#fff}.senuke-layout-text-auto.senuke-layout-bg-primary,.senuke-layout-text-auto.senuke-layout-bg-secondary,.senuke-layout-text-auto.senuke-layout-bg-dark{color:#fff}
.senuke-layout-text-white .senuke-layout-column h1,.senuke-layout-text-white .senuke-layout-column h2,.senuke-layout-text-white .senuke-layout-column h3,.senuke-layout-text-white .senuke-layout-column p,.senuke-layout-text-auto.senuke-layout-bg-primary .senuke-layout-column h1,.senuke-layout-text-auto.senuke-layout-bg-primary .senuke-layout-column h2,.senuke-layout-text-auto.senuke-layout-bg-primary .senuke-layout-column h3,.senuke-layout-text-auto.senuke-layout-bg-primary .senuke-layout-column p,.senuke-layout-text-auto.senuke-layout-bg-secondary .senuke-layout-column h1,.senuke-layout-text-auto.senuke-layout-bg-secondary .senuke-layout-column h2,.senuke-layout-text-auto.senuke-layout-bg-secondary .senuke-layout-column h3,.senuke-layout-text-auto.senuke-layout-bg-secondary .senuke-layout-column p,.senuke-layout-text-auto.senuke-layout-bg-dark .senuke-layout-column h1,.senuke-layout-text-auto.senuke-layout-bg-dark .senuke-layout-column h2,.senuke-layout-text-auto.senuke-layout-bg-dark .senuke-layout-column h3,.senuke-layout-text-auto.senuke-layout-bg-dark .senuke-layout-column p{color:#fff}
.senuke-layout-spacing-compact{padding-block:1.75rem}.senuke-layout-spacing-comfortable{padding-block:clamp(3rem,6vw,5rem)}.senuke-layout-spacing-spacious{padding-block:clamp(4.5rem,9vw,7.5rem)}
.senuke-second-fold{text-align:center}
.senuke-second-fold>h2,.senuke-second-fold>div>h2{max-width:30ch;margin:0 auto 1.15rem;text-align:center;text-wrap:balance}
.senuke-second-fold>p,.senuke-second-fold>div>p{max-width:72ch;margin:.8rem auto 0;text-align:center}
.senuke-rich-text{width:min(900px,calc(100% - 2rem));padding-block:clamp(3rem,5vw,4.5rem);text-align:center}
.senuke-rich-text h2{max-width:30ch;margin:0 auto 1.15rem;font-size:clamp(1.75rem,3vw,2.35rem);letter-spacing:-.02em;text-wrap:balance}
.senuke-rich-text p{max-width:72ch;margin:.8rem auto 0;color:var(--senuke-muted);font-size:1rem;line-height:1.75}
.senuke-align-left{text-align:left}.senuke-align-center{text-align:center}.senuke-align-right{text-align:right}
.senuke-align-left>h1,.senuke-align-left>h2,.senuke-align-left>p,.senuke-align-left>div>h1,.senuke-align-left>div>h2,.senuke-align-left>div>p{margin-left:0;margin-right:auto;text-align:left}
.senuke-align-center>h1,.senuke-align-center>h2,.senuke-align-center>p,.senuke-align-center>div>h1,.senuke-align-center>div>h2,.senuke-align-center>div>p{margin-left:auto;margin-right:auto;text-align:center}
.senuke-align-right>h1,.senuke-align-right>h2,.senuke-align-right>p,.senuke-align-right>div>h1,.senuke-align-right>div>h2,.senuke-align-right>div>p{margin-left:auto;margin-right:0;text-align:right}
.senuke-heading-small h1,.senuke-heading-small h2{font-size:clamp(1.55rem,3vw,2.35rem)}.senuke-heading-medium h1,.senuke-heading-medium h2{font-size:clamp(2rem,4vw,3.15rem)}.senuke-heading-large h1,.senuke-heading-large h2{font-size:clamp(2.6rem,6vw,4.5rem)}
.senuke-heading-regular h1,.senuke-heading-regular h2{font-weight:500}.senuke-heading-semibold h1,.senuke-heading-semibold h2{font-weight:650}.senuke-heading-bold h1,.senuke-heading-bold h2{font-weight:800}.senuke-heading-black h1,.senuke-heading-black h2{font-weight:950}
.senuke-heading-color-primary h1,.senuke-heading-color-primary h2{color:var(--senuke-primary)}.senuke-heading-color-secondary h1,.senuke-heading-color-secondary h2{color:var(--senuke-secondary)}.senuke-heading-color-accent h1,.senuke-heading-color-accent h2{color:var(--senuke-accent)}.senuke-heading-color-text h1,.senuke-heading-color-text h2{color:var(--senuke-text)}
.senuke-hero{min-height:64vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.8fr);align-items:center;gap:clamp(2rem,6vw,5rem)}
.senuke-hero-image{width:100%;max-height:620px;border-radius:1.25rem;object-fit:cover}
.senuke-media{padding-block:clamp(1.5rem,4vw,3rem);text-align:center}
.senuke-media img{display:block;width:100%;max-height:620px;object-fit:cover;border-radius:1.25rem}
.senuke-media-wide{width:100%;max-width:none}
.senuke-media-inline{width:min(960px,calc(100% - 2rem))}
.senuke-media-card{padding:1rem;background:var(--senuke-surface);border-radius:1.25rem;box-shadow:0 18px 50px rgba(15,23,42,.12)}
.senuke-media figcaption{margin-top:.75rem;color:var(--senuke-muted);font-size:.9rem}
.senuke-eyebrow{font-weight:800;color:var(--senuke-primary);text-transform:uppercase;letter-spacing:.08em}
.senuke-lead{font-size:1.2rem;max-width:62ch;color:var(--senuke-muted)}
.senuke-button{display:inline-block;width:max-content;border:0;border-radius:.75rem;background:var(--senuke-primary);color:#fff!important;font-weight:800;padding:.85rem 1.2rem;text-decoration:none}
.senuke-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1rem}
.senuke-card,.senuke-faq details{border:1px solid color-mix(in srgb,var(--senuke-muted) 20%,transparent);border-radius:1rem;background:var(--senuke-surface);padding:1.25rem}
.senuke-steps{display:grid;gap:1rem}
.senuke-proof,.senuke-cta{border-radius:1.25rem}
.senuke-cta{background:var(--senuke-secondary);color:#fff;padding-inline:clamp(1.5rem,5vw,4rem)}
.senuke-contact-form{display:grid;grid-template-columns:minmax(0,.8fr) minmax(300px,1.2fr);gap:clamp(2rem,6vw,5rem);align-items:start}
.senuke-contact-form form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;padding:clamp(1.25rem,4vw,2.25rem);border-radius:1.25rem;background:var(--senuke-surface);box-shadow:0 20px 60px rgba(15,23,42,.1)}
.senuke-contact-form label{display:grid;gap:.45rem;font-weight:750}
.senuke-contact-form input,.senuke-contact-form textarea{width:100%;border:1px solid color-mix(in srgb,var(--senuke-muted) 30%,transparent);border-radius:.75rem;background:var(--senuke-background);padding:.8rem;font:inherit}
.senuke-contact-form label:has(textarea),.senuke-form-consent,.senuke-contact-form .senuke-button,.senuke-form-status{grid-column:1/-1}
.senuke-form-consent{display:flex!important;align-items:flex-start}
.senuke-form-consent input{width:auto;margin-top:.35rem}
.senuke-form-status{margin:0;font-weight:750;color:var(--senuke-primary)}
.senuke-form-error{color:#b91c1c}
.senuke-faq details+details{margin-top:.75rem}
.senuke-faq summary{cursor:pointer;font-weight:800}
.senuke-site-footer{margin-top:4rem;background:var(--senuke-text);padding:3rem max(1rem,calc((100% - 1120px)/2));color:#cbd5e1;font-size:.85rem}
.senuke-site-footer>strong{color:#fff;font-size:1.2rem}
.senuke-footer-contact{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.75rem}
.senuke-footer-contact a{color:inherit}
.senuke-social-links{display:flex;flex-wrap:wrap;gap:.65rem;margin-top:1.25rem}
.senuke-social-links a{display:grid;width:40px;height:40px;place-items:center;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.08);color:#fff;transition:transform .18s ease,background .18s ease}
.senuke-social-links a:hover,.senuke-social-links a:focus-visible{transform:translateY(-2px);background:var(--senuke-primary)}
.senuke-social-links svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}
.senuke-social-links svg .senuke-social-fill{fill:currentColor;stroke:none}
.senuke-footer-navigation{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.5rem;margin-block:2rem}
.senuke-footer-navigation h2{font-size:.9rem;color:#fff}
.senuke-footer-navigation ul{list-style:none;margin:0;padding:0}
.senuke-footer-navigation li+li{margin-top:.4rem}
.senuke-footer-navigation a{color:inherit;text-decoration:none}
.senuke-footer-copyright{border-top:1px solid rgba(255,255,255,.16);margin-top:2rem;padding-top:1rem;color:#94a3b8}
@media(max-width:860px){
 .senuke-layout-columns{grid-template-columns:1fr!important}
 .senuke-site-header{position:sticky!important;top:0!important;display:flex;min-height:68px;flex-direction:row;align-items:center;padding-block:.65rem}
 .senuke-header-navigation{display:none}
 .senuke-mobile-menu{display:block;margin-left:auto}
 .senuke-mobile-menu>summary{display:grid;width:46px;height:46px;cursor:pointer;place-items:center;border:1px solid color-mix(in srgb,var(--senuke-muted) 25%,transparent);border-radius:.75rem;background:var(--senuke-surface);list-style:none}
 .senuke-mobile-menu>summary::-webkit-details-marker{display:none}
 .senuke-menu-icon{display:grid!important;width:22px;gap:4px}
 .senuke-menu-icon i{display:block;height:2px;border-radius:99px;background:var(--senuke-text);transition:transform .2s ease,opacity .2s ease}
 .senuke-mobile-menu[open] .senuke-menu-icon i:nth-child(1){transform:translateY(6px) rotate(45deg)}
 .senuke-mobile-menu[open] .senuke-menu-icon i:nth-child(2){opacity:0}
 .senuke-mobile-menu[open] .senuke-menu-icon i:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
 .senuke-mobile-menu-panel{position:absolute;z-index:100;inset:100% 0 auto;width:100%;max-height:calc(100dvh - 68px);overflow-y:auto;overscroll-behavior:contain;border-top:1px solid color-mix(in srgb,var(--senuke-muted) 20%,transparent);background:var(--senuke-surface);padding:1rem max(1rem,calc((100% - 720px)/2));box-shadow:0 24px 45px rgba(15,23,42,.18)}
 .senuke-mobile-menu-panel nav>ul{display:grid;gap:.25rem}
 .senuke-mobile-menu-panel li{width:100%}
 .senuke-mobile-menu-panel a,.senuke-mobile-menu-panel span{display:block;border-radius:.65rem;padding:.75rem .8rem;text-decoration:none}
 .senuke-mobile-menu-panel li ul{position:static;display:grid;min-width:0;margin:.1rem 0 .35rem .75rem;padding:.2rem 0 .2rem .65rem;border-left:2px solid color-mix(in srgb,var(--senuke-primary) 25%,transparent);box-shadow:none}
 .senuke-mobile-menu-panel .senuke-utility-nav{margin-bottom:.6rem;padding-bottom:.6rem;border-bottom:1px solid color-mix(in srgb,var(--senuke-muted) 18%,transparent)}
 .senuke-brand{max-width:calc(100% - 64px)}
 .senuke-brand-logo{max-width:min(160px,100%);height:44px}
 .senuke-component,.senuke-breadcrumbs,.senuke-contextual-links,.senuke-related-pages,.senuke-link-cta{width:min(100% - 1.5rem,720px)}
 h1{max-width:100%;font-size:clamp(2.1rem,10vw,3.6rem)}
 .senuke-hero,.senuke-contact-form{grid-template-columns:1fr;min-height:auto}
 .senuke-hero{padding-block:3.5rem}
 .senuke-hero-image{max-height:420px}
 .senuke-contact-form form{grid-template-columns:1fr}
 .senuke-contact-form form>*{grid-column:1!important}
 .senuke-cta{margin-inline:1rem}
 .senuke-site-footer{margin-top:2rem}
 .senuke-footer-contact{display:grid;gap:.65rem}
 .senuke-footer-contact>span{display:none}
}
@media(max-width:540px){
 .senuke-grid{grid-template-columns:1fr}
 .senuke-component{padding-block:2.75rem}
 .senuke-hero{padding-block:3rem}
 .senuke-hero-image,.senuke-media img{max-height:340px}
 .senuke-card,.senuke-faq details{padding:1rem}
 .senuke-cta{width:calc(100% - 1rem);margin-inline:.5rem;padding-inline:1.25rem}
 .senuke-footer-navigation{grid-template-columns:1fr 1fr}
}
`;

const SENUKE_PROFESSIONAL_CSS = `
body{background:linear-gradient(180deg,var(--senuke-background),var(--senuke-surface) 30%,var(--senuke-background))}
.senuke-site-header{position:sticky;top:0;z-index:50;width:100%;max-width:none;padding-inline:max(1rem,calc((100% - 1120px)/2));background:color-mix(in srgb,var(--senuke-surface) 92%,transparent);border-bottom:1px solid color-mix(in srgb,var(--senuke-muted) 16%,transparent);backdrop-filter:blur(16px);box-shadow:0 10px 35px rgba(15,23,42,.06)}
.senuke-site-header>nav>ul{align-items:center}.senuke-site-header a{text-decoration:none;font-weight:750}
.senuke-hero{position:relative;isolation:isolate;width:100%;max-width:none;padding-inline:max(1rem,calc((100% - 1120px)/2));background:radial-gradient(circle at 90% 10%,color-mix(in srgb,var(--senuke-accent) 25%,transparent),transparent 28%),linear-gradient(135deg,var(--senuke-background),var(--senuke-surface) 55%,color-mix(in srgb,var(--senuke-secondary) 10%,white))}
.senuke-hero h1{letter-spacing:-.045em;text-wrap:balance}.senuke-hero-image{aspect-ratio:3/2;box-shadow:0 30px 80px rgba(15,23,42,.2)}
.senuke-rich-text{display:block;width:min(900px,calc(100% - 2rem));padding-block:clamp(3rem,5vw,4.5rem);text-align:center}.senuke-rich-text h2{max-width:30ch;margin:0 auto 1.15rem;font-size:clamp(1.75rem,3vw,2.35rem);letter-spacing:-.02em;text-wrap:balance}.senuke-rich-text p{max-width:72ch;margin:.8rem auto 0;color:var(--senuke-muted);font-size:1rem;line-height:1.75}
.senuke-align-left{text-align:left}.senuke-align-center{text-align:center}.senuke-align-right{text-align:right}.senuke-align-left>h1,.senuke-align-left>h2,.senuke-align-left>p,.senuke-align-left>div>h1,.senuke-align-left>div>h2,.senuke-align-left>div>p{margin-left:0;margin-right:auto;text-align:left}.senuke-align-center>h1,.senuke-align-center>h2,.senuke-align-center>p,.senuke-align-center>div>h1,.senuke-align-center>div>h2,.senuke-align-center>div>p{margin-left:auto;margin-right:auto;text-align:center}.senuke-align-right>h1,.senuke-align-right>h2,.senuke-align-right>p,.senuke-align-right>div>h1,.senuke-align-right>div>h2,.senuke-align-right>div>p{margin-left:auto;margin-right:0;text-align:right}
.senuke-heading-small h1,.senuke-heading-small h2{font-size:clamp(1.55rem,3vw,2.35rem)}.senuke-heading-medium h1,.senuke-heading-medium h2{font-size:clamp(2rem,4vw,3.15rem)}.senuke-heading-large h1,.senuke-heading-large h2{font-size:clamp(2.6rem,6vw,4.5rem)}.senuke-heading-regular h1,.senuke-heading-regular h2{font-weight:500}.senuke-heading-semibold h1,.senuke-heading-semibold h2{font-weight:650}.senuke-heading-bold h1,.senuke-heading-bold h2{font-weight:800}.senuke-heading-black h1,.senuke-heading-black h2{font-weight:950}.senuke-heading-color-primary h1,.senuke-heading-color-primary h2{color:var(--senuke-primary)}.senuke-heading-color-secondary h1,.senuke-heading-color-secondary h2{color:var(--senuke-secondary)}.senuke-heading-color-accent h1,.senuke-heading-color-accent h2{color:var(--senuke-accent)}.senuke-heading-color-text h1,.senuke-heading-color-text h2{color:var(--senuke-text)}
.senuke-services .senuke-card{position:relative;overflow:hidden;min-height:210px;padding:1.75rem;border:0;box-shadow:0 18px 55px rgba(15,23,42,.08)}.senuke-services .senuke-card:before{content:"";position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(var(--senuke-primary),var(--senuke-accent))}
.senuke-benefits{width:100%;max-width:none;padding-inline:max(1rem,calc((100% - 1120px)/2));background:var(--senuke-secondary);color:#fff}.senuke-benefits .senuke-card{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.1)}.senuke-benefits .senuke-card p{color:rgba(255,255,255,.75)}
.senuke-process .senuke-steps{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:0;list-style:none}.senuke-process .senuke-steps li{padding:1.5rem;border-radius:1rem;background:var(--senuke-surface);box-shadow:0 16px 45px rgba(15,23,42,.07)}
.senuke-proof{padding-inline:clamp(1.5rem,5vw,4rem);background:linear-gradient(135deg,color-mix(in srgb,var(--senuke-accent) 13%,white),var(--senuke-surface))}
.senuke-cta{position:relative;overflow:hidden;margin-block:3rem 5rem;background:linear-gradient(135deg,var(--senuke-secondary),color-mix(in srgb,var(--senuke-secondary) 76%,var(--senuke-primary)));box-shadow:0 28px 80px color-mix(in srgb,var(--senuke-secondary) 35%,transparent)}
.senuke-faq{width:min(920px,calc(100% - 2rem))}.senuke-faq details{box-shadow:0 10px 30px rgba(15,23,42,.05)}
@media(max-width:860px){.senuke-rich-text{padding-block:2.75rem}.senuke-site-header{position:sticky!important}.senuke-hero{padding-block:4rem}}
`;

export function createStaticWebsiteFiles(
  model: WebsiteModel,
  options: WebsiteRenderOptions = {},
): WebsiteRenderFile[] {
  const assetUrls: Record<string, string> = {};
  const mediaFiles: WebsiteRenderFile[] = [];
  for (const asset of model.mediaAssets) {
    const source = asset.sourceUrl || "";
    const data = source.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([a-z0-9+/=\s]+)$/i);
    if (data) {
      const extension = data[1] === "image/jpeg" ? "jpg" : data[1] === "image/svg+xml" ? "svg" : data[1].split("/")[1];
      const path = `assets/media/${asset.assetId.replace(/[^a-z0-9_-]+/gi, "-")}.${extension}`;
      mediaFiles.push({ path, content: data[2].replace(/\s+/g, ""), mimeType: data[1], base64: true });
      assetUrls[asset.assetId] = `/${path}`;
    } else if (/^https:\/\//i.test(source)) {
      assetUrls[asset.assetId] = source;
    }
  }
  const pageFiles = model.pages.map((page) => {
    const path = normalizedPath(page.slug);
    const directoryDepth = path === "/" ? 0 : path.replace(/^\/|\/$/g, "").split("/").filter(Boolean).length;
    const relativeRoot = directoryDepth ? "../".repeat(directoryDepth) : "";
    const internalUrlMap = Object.fromEntries(model.pages.map((targetPage) => {
      const targetPath = normalizedPath(targetPage.slug);
      const targetFile = targetPath === "/"
        ? "index.html"
        : `${targetPath.replace(/^\/|\/$/g, "")}/index.html`;
      return [targetPath, `${relativeRoot}${targetFile}`];
    }));
    const pageAssetUrls = Object.fromEntries(Object.entries(assetUrls).map(([assetId, url]) => [
      assetId,
      url.startsWith("/") ? `${relativeRoot}${url.slice(1)}` : url,
    ]));
    return {
      path: path === "/" ? "index.html" : `${path.replace(/^\/|\/$/g, "")}/index.html`,
      content: renderWebsitePageDocument(model, page, {
        ...options,
        stylesheetHref: `${relativeRoot}assets/senuke.css`,
        mediaAssets: model.mediaAssets,
        assetUrls: pageAssetUrls,
        internalUrlMap,
      }),
      mimeType: "text/html",
    };
  });
  const sitemapUrls = model.pages.map((page) => {
    const path = normalizedPath(page.slug);
    const location = options.baseUrl ? `${options.baseUrl.replace(/\/+$/, "")}${path}` : path;
    return `<url><loc>${escapeHtml(location)}</loc></url>`;
  }).join("");
  const llmsPages = model.pages.map((page) => `- [${page.name}](${normalizedPath(page.slug)}): ${page.seo.metaDescription}`).join("\n");
  const manifest = {
    generator: "SENuke AI Static HTML Renderer",
    rendererVersion: "1.0.0",
    approvedReleaseId: options.approvedReleaseId ?? null,
    snapshotHash: options.snapshotHash ?? null,
    websiteModelId: model.modelId,
    websiteModelVersion: model.version,
    componentRegistryVersion: model.componentRegistryVersion,
    pageCount: model.pages.length,
    pages: model.pages.map((page) => ({ pageId: page.pageId, name: page.name, path: normalizedPath(page.slug) })),
  };
  return [
    ...pageFiles,
    ...mediaFiles,
    { path: "assets/senuke.css", content: `${SENUKE_STATIC_CSS}\n${SENUKE_PROFESSIONAL_CSS}`, mimeType: "text/css" },
    { path: "sitemap.xml", content: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapUrls}</urlset>`, mimeType: "application/xml" },
    { path: "robots.txt", content: `User-agent: *\nAllow: /\nSitemap: ${options.baseUrl ? `${options.baseUrl.replace(/\/+$/, "")}/sitemap.xml` : "/sitemap.xml"}\n`, mimeType: "text/plain" },
    { path: "llms.txt", content: `# Website pages\n\n${llmsPages}\n`, mimeType: "text/plain" },
    { path: "senuke-release.json", content: JSON.stringify(manifest, null, 2), mimeType: "application/json" },
  ];
}
