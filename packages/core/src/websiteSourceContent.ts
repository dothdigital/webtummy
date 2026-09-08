import { load } from "cheerio";
import type { WebsiteComponentInstance } from "./websiteModel.js";

/** Recover document copy without importing scripts, navigation, or source-site styling. */
export function extractWebsiteSourceDocument(html: string, sourceUrl: string) {
  const $ = load(html);
  $("script,style,noscript,nav,header,footer,form,aside,[hidden],[aria-hidden=true]").remove();
  let root = $("main").first().length ? $("main").first() : $("article").first();
  // Older sites often use a div rather than semantic main/article elements.
  if (!root.length) {
    const heading = $("h1").first();
    const candidate = heading.parents("div,section").filter((_, el) => $(el).find("p").length >= 2 && $(el).find("h2").length > 0).first();
    if (candidate.length) root = candidate;
  }
  if (!root.length) throw new Error("The source page has no identifiable main document; automatic recovery stopped.");
  root.find("a[href]").each((_, el) => {
    const a = $(el), label = a.text().replace(/\s+/g, " ").trim();
    try {
      const url = new URL(a.attr("href") || "", sourceUrl);
      if (["https:", "http:", "mailto:", "tel:"].includes(url.protocol) && label && !label.includes(url.href)) a.text(`${label} (${url.href})`);
    } catch { /* Invalid links do not become active content. */ }
  });
  const title = root.find("h1").first().text().replace(/\s+/g, " ").trim() || $("title").text().trim();
  const sections: Array<{ heading: string; body: string }> = [];
  let heading = title, parts: string[] = [];
  const flush = () => { if (parts.length) sections.push({ heading, body: parts.join("\n\n") }); parts = []; };
  const visit = (node: any) => {
    if (node.type === "text") {
      const text = String(node.data || "").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
      return;
    }
    if (node.type !== "tag") return;
    const tag = node.tagName.toLowerCase();
    if (tag === "h1") return;
    const text = $(node).text().replace(/\s+/g, " ").trim();
    if (tag === "h2") { flush(); heading = text; return; }
    if (["p", "li", "h3", "h4", "blockquote", "pre", "tr"].includes(tag)) {
      if (text) parts.push(tag === "li" ? `• ${text}` : text);
      return;
    }
    for (const child of node.children || []) visit(child);
  };
  for (const child of root.contents().toArray()) visit(child);
  flush();
  if (!title || sections.reduce((n, s) => n + s.body.length, 0) < 300) throw new Error("The source document is incomplete; automatic recovery stopped.");
  return { title, sections };
}

export function websiteSourceDocumentComponents(document: ReturnType<typeof extractWebsiteSourceDocument>, prefix: string): WebsiteComponentInstance[] {
  return document.sections.flatMap((section, sectionIndex) => {
    // Respect the component field bound without dropping the end of a document.
    const chunks: string[] = [];
    let remaining = section.heading.length > 85 ? `${section.heading}\n\n${section.body}` : section.body;
    while (remaining.length > 3900) {
      const boundary = remaining.lastIndexOf(" ", 3900);
      const end = boundary > 0 ? boundary : 3900;
      chunks.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks.map((body, index) => ({
      instanceId: `${prefix}-source-${sectionIndex + 1}-${index + 1}`,
      componentId: "content.rich_text", componentVersion: "1.0.0", variant: "standard",
      props: { heading: `${section.heading.slice(0, 85)}${index ? " (continued)" : ""}`, body, alignment: "left" },
    }));
  });
}
