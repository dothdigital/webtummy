import { cleanGeographicTargetMarkets } from "./project-location.js";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function values(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[;\n]/);
  return [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Preserve a confirmed physical location separately from target markets. */
export function discoveryBusinessLocation(input: { understanding?: unknown; facts?: unknown; answers?: unknown }) {
  const understanding = record(input.understanding);
  const answers = record(input.answers);
  const structured = [understanding.businessLocation, understanding.physicalLocation, answers.businessLocation].map(text).find(Boolean);
  if (structured) return structured.slice(0, 255);
  for (const raw of Array.isArray(input.facts) ? input.facts : []) {
    const fact = record(raw);
    const key = String(fact.key ?? fact.name ?? "").trim();
    const confirmed = String(fact.state ?? "").toUpperCase() === "CONFIRMED" || String(fact.source ?? "").toUpperCase() === "USER_INPUT";
    if (!confirmed || !/(?:business|physical|company|office|store|headquarters?).*location|location.*(?:business|physical|company|office|store|headquarters?)/i.test(key)) continue;
    const location = text(fact.value ?? fact.text ?? fact.description);
    if (location) return location.slice(0, 255);
  }
  return null;
}

function labelledMarkets(text: string) {
  const candidates: string[] = [];
  const pattern = /(?:^|[\n.!?])\s*(?:we\s+)?(?:target\s+markets?|target\s+locations?|service\s+areas?|locations?\s+served|markets?\s+served|serve|serving|targeting)\s*(?:are|is|include|includes|:|-)?\s*([^\n.!?]+)/gi;
  for (const match of text.matchAll(pattern)) {
    const candidate = String(match[1] ?? "")
      .split(/\s*,?\s+but\b|\s+although\b|\s+while\b/i)[0]
      ?.replace(/^(?:customers?\s+)?(?:in|across|throughout)\s+/i, "")
      .trim();
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Recover only explicitly supplied geographic target markets from Discovery.
 * Audience descriptions and inferred beachhead-market prose are deliberately
 * excluded because this value controls paid keyword-location checks.
 */
export function discoveryTargetMarkets(input: {
  understanding?: unknown;
  facts?: unknown;
  answers?: unknown;
  sourceText?: string | null;
}) {
  const understanding = record(input.understanding);
  const answers = record(input.answers);
  const structured = [
    ...values(understanding.targetMarkets),
    ...values(understanding.targetLocations),
    ...values(understanding.serviceAreas),
  ];
  const confirmedFacts = (Array.isArray(input.facts) ? input.facts : []).flatMap((raw) => {
    const fact = record(raw);
    const key = String(fact.key ?? fact.name ?? "").trim();
    const confirmed = String(fact.state ?? "").toUpperCase() === "CONFIRMED" || String(fact.source ?? "").toUpperCase() === "USER_INPUT";
    if (!confirmed || !/(?:target.*(?:market|location)|service.?area|location.*served|market.*served)/i.test(key)) return [];
    return values(fact.value ?? fact.text ?? fact.description);
  });
  const sourceText = [input.sourceText, typeof answers.main === "string" ? answers.main : ""].filter(Boolean).join("\n");
  return cleanGeographicTargetMarkets([...structured, ...confirmedFacts, ...labelledMarkets(sourceText)]).slice(0, 50);
}

export function latestExplicitConversationTargetMarkets(messages: unknown) {
  if (!Array.isArray(messages)) return [];
  for (const raw of [...messages].reverse()) {
    const message = record(raw);
    if (String(message.role ?? "").toLocaleLowerCase() !== "user") continue;
    const text = typeof message.text === "string" ? message.text : typeof message.content === "string" ? message.content : "";
    const markets = discoveryTargetMarkets({ sourceText: text });
    if (markets.length) return markets;
  }
  return [];
}

export function sameGeographicTargetMarkets(left: unknown, right: unknown) {
  const normalize = (value: unknown) => cleanGeographicTargetMarkets(Array.isArray(value) ? value.map(String) : [])
    .map((market) => market.toLocaleLowerCase())
    .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
