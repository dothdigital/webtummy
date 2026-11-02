const instructionStopWords = new Set([
  "about", "address", "aimed", "article", "based", "content", "cover", "create", "focus", "generate", "geographic", "geography", "include", "including", "location", "market", "mention", "page", "please", "region", "target", "toward", "using", "website", "written", "should", "must", "with", "from", "that", "this", "their", "there", "into", "only", "also", "make", "sure", "your", "have", "will", "want", "need", "specifically", "primarily",
]);

function normalizedInstructionText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bsuper[\s-]*visa\b/g, "supervisa")
    .replace(/\bgrand[\s-]+parents?\b/g, "grandparent")
    .replace(/\bparents\b/g, "parent")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedTerm(value: string) {
  const normalized = normalizedInstructionText(value);
  if (normalized.length > 5 && normalized.endsWith("s") && !normalized.endsWith("ss")) return normalized.slice(0, -1);
  return normalized;
}

function prominentArticleText(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const record = result as Record<string, unknown>;
  const articleHtml = typeof record.articleHtml === "string" ? record.articleHtml : "";
  const opening = articleHtml.replace(/<[^>]+>/g, " ").slice(0, 900);
  return normalizedInstructionText(JSON.stringify({ title: record.title, outline: record.outline, opening }));
}

function requiredArticleEmphasis(instructions: string | null | undefined) {
  if (!instructions?.trim()) return { subjects: [] as string[], geographies: [] as string[] };
  const subjects: string[] = [];
  const geographies: string[] = [];
  for (const clause of instructions.split(/[\n.!?;]+/).map((value) => value.trim()).filter(Boolean)) {
    const subjectMatch = clause.match(/\b(?:focus(?:ed)?\s+on|mention(?:\s+about)?|cover|address|feature)\s+(.+?)(?=\s+(?:and|with)\s+(?:target(?:ed)?\s+)?(?:geograph(?:y|ic)|location|market|region)\b|$)/i);
    if (subjectMatch?.[1]) {
      const terms = requiredInstructionTerms(`Focus on ${subjectMatch[1]}`);
      if (terms[0]) subjects.push(terms[0]);
    }
    const geographyMatch = clause.match(/\b(?:target(?:ed)?\s+)?(?:geograph(?:y|ic)|location|market|region)\s*(?:is|of|:|-)?\s+([a-z][a-z .'-]{2,})$/i);
    if (geographyMatch?.[1]) {
      const terms = normalizedInstructionText(geographyMatch[1]).split(/\s+/).map(normalizedTerm).filter((term) => term.length >= 3 && !instructionStopWords.has(term));
      if (terms[0]) geographies.push(terms[0]);
    }
  }
  return { subjects: [...new Set(subjects)], geographies: [...new Set(geographies)] };
}

export function requiredInstructionTerms(instructions: string | null | undefined) {
  if (!instructions?.trim()) return [];
  const positiveClauses = instructions
    .split(/[\n.!?;]+/)
    .map((clause) => clause.split(/\b(?:but|avoid|do\s+not|don't|without|exclude)\b/i)[0]?.trim() ?? "")
    .filter((clause) => /\b(?:focus(?:ed)?\s+on|include|cover|mention|address|feature|target(?:ed)?\s+(?:at|to)|aimed\s+at|written\s+for)\b/i.test(clause));
  const terms = positiveClauses
    .flatMap((clause) => normalizedInstructionText(clause).split(/\s+/))
    .map(normalizedTerm)
    .filter((term) => term.length >= 4 && !instructionStopWords.has(term) && !/^\d+$/.test(term));
  return [...new Set(terms)].slice(0, 12);
}

export function instructionVisibleText(result: unknown, contentType: string) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return String(result ?? "");
  const record = result as Record<string, unknown>;
  if (contentType !== "article") return JSON.stringify(result);
  return JSON.stringify({
    title: record.title,
    outline: record.outline,
    articleHtml: record.articleHtml,
    faqs: record.faqs,
  });
}

export function missingRequiredInstructionTerms(instructions: string | null | undefined, result: unknown, contentType: string) {
  const required = requiredInstructionTerms(instructions);
  if (!required.length) return [];
  const visible = normalizedInstructionText(instructionVisibleText(result, contentType));
  const words = new Set(visible.split(/\s+/).map(normalizedTerm));
  const compact = visible.replace(/\s+/g, "");
  const missing = required.filter((term) => !words.has(term) && !compact.includes(term.replace(/\s+/g, "")));
  if (contentType !== "article") return missing;

  const prominent = prominentArticleText(result);
  const counts = visible.split(/\s+/).map(normalizedTerm).reduce<Record<string, number>>((resultCounts, word) => {
    resultCounts[word] = (resultCounts[word] ?? 0) + 1;
    return resultCounts;
  }, {});
  const emphasis = requiredArticleEmphasis(instructions);
  for (const term of emphasis.subjects) {
    if (!prominent.split(/\s+/).includes(term) || (counts[term] ?? 0) < 3) missing.push(`${term} (must be a central article subject)`);
  }
  for (const term of emphasis.geographies) {
    if (!prominent.split(/\s+/).includes(term) || (counts[term] ?? 0) < 2) missing.push(`${term} (must shape the local article)`);
  }
  return [...new Set(missing)];
}
