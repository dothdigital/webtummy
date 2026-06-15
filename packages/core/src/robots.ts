// Minimal but correct robots.txt parser. Handles user-agent groups, Allow/Disallow
// with longest-match precedence, wildcards (* and $), and Sitemap directives.
// NOT a full RFC 9309 impl, but covers the cases that matter for crawl politeness.

interface Rule {
  type: "allow" | "disallow";
  path: string;
}

export interface ParsedRobots {
  rules: Rule[];          // rules for our UA group (merged with *)
  sitemaps: string[];
  raw: string;
}

export function parseRobots(content: string, userAgent: string): ParsedRobots {
  const lines = content.split(/\r?\n/);
  const sitemaps: string[] = [];

  // Group rules by the user-agent they apply to.
  const groups: Record<string, Rule[]> = {};
  let currentAgents: string[] = [];
  let lastWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!lastWasAgent) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      groups[value.toLowerCase()] ??= [];
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;

    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (field === "allow" || field === "disallow") {
      for (const agent of currentAgents) {
        (groups[agent] ??= []).push({ type: field, path: value });
      }
    }
  }

  // Pick the most specific matching group: our UA token, else "*".
  const uaToken = userAgent.toLowerCase();
  const matchKey =
    Object.keys(groups).find((k) => k !== "*" && uaToken.includes(k)) ??
    (groups["*"] ? "*" : undefined);
  const rules = matchKey ? groups[matchKey] : [];

  return { rules, sitemaps, raw: content };
}

/** robots wildcard pattern -> RegExp. `*` = any run, `$` = end-anchor. */
function patternToRegExp(path: string): RegExp {
  let re = "";
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === "*") re += ".*";
    else if (c === "$" && i === path.length - 1) re += "$";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re);
}

/** Is `pathname` allowed? Longest-matching rule wins; Allow beats Disallow on a tie. */
export function isAllowed(robots: ParsedRobots, pathname: string): boolean {
  let best: { rule: Rule; len: number } | null = null;
  for (const rule of robots.rules) {
    if (rule.path === "") {
      // "Disallow:" (empty) means allow everything for that group.
      if (rule.type === "disallow") continue;
    }
    if (patternToRegExp(rule.path).test(pathname)) {
      const len = rule.path.length;
      if (!best || len > best.len || (len === best.len && rule.type === "allow")) {
        best = { rule, len };
      }
    }
  }
  if (!best) return true;
  return best.rule.type === "allow";
}
