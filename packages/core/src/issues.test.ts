import { describe, expect, it } from "vitest";
import { detectPageIssues } from "./issues.js";
import type { FetchResult, ParsedPage } from "./types.js";

const parsedErrorDocument: ParsedPage = {
  title: null,
  metaDescription: null,
  h1: [],
  h2: [],
  canonicalUrl: null,
  robotsMeta: null,
  hreflangs: [],
  ampUrl: null,
  ogTags: {},
  twitterTags: {},
  links: [],
  images: [],
  assets: [],
  schemas: [],
  wordCount: 3,
  visibleTextHash: null,
  looksJsDependent: false,
};

function fetched(statusCode: number): FetchResult {
  return {
    url: "https://example.com/blog.html/",
    finalUrl: "https://example.com/blog.html/",
    statusCode,
    contentType: "text/html",
    body: "<html>Not found</html>",
    responseTimeMs: 10,
    redirectChain: [],
    headers: {},
  };
}

describe("detectPageIssues", () => {
  it("reports a 404 as an indexability error without auditing the error document as content", () => {
    const issues = detectPageIssues(
      fetched(404),
      parsedErrorDocument,
      "https://example.com/blog.html/",
    );

    expect(issues.map((issue) => issue.issueType)).toEqual(["client_error"]);
  });
});
