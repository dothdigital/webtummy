import DOMPurify from "dompurify";

const BASIC_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"];
const RICH_TAGS = [
  ...BASIC_TAGS,
  "h1", "h2", "h3", "h4", "h5", "h6", "a", "blockquote", "code", "pre", "hr",
  "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "img", "span", "div",
];

export type HtmlSanitizationProfile = "basic" | "rich";

export function sanitizeHtml(value: unknown, profile: HtmlSanitizationProfile = "rich") {
  return DOMPurify.sanitize(String(value ?? ""), {
    ALLOWED_TAGS: profile === "basic" ? BASIC_TAGS : RICH_TAGS,
    ALLOWED_ATTR: profile === "basic"
      ? []
      : ["href", "title", "target", "rel", "src", "alt", "width", "height", "class"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "svg", "math", "template"],
    FORBID_ATTR: ["style", "srcset"],
  }) as string;
}
