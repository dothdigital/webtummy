import { describe, expect, it } from "vitest";
import { mergeTargetMarkets, targetMarketPhrase } from "./intake-markets.js";

describe("intake target-market suggestions", () => {
  it("keeps every selected city in audience suggestion context", () => {
    expect(targetMarketPhrase("", ["Toronto", "Mississauga", "Brampton", "Oakville"])).toBe(" across Toronto, Mississauga, Brampton and Oakville");
  });

  it("formats country and city targets naturally", () => {
    expect(targetMarketPhrase("", ["Canada", "Toronto", "Mississauga", "Oakville"])).toBe(" in Canada, including Toronto, Mississauga and Oakville");
  });

  it("merges older intake answers with canonical project targets", () => {
    expect(mergeTargetMarkets(["Canada", "Toronto"], ["Toronto", "Mississauga", "Brampton", "Oakville"])).toEqual(["Canada", "Toronto", "Mississauga", "Brampton", "Oakville"]);
  });
});
