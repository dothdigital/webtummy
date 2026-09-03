import { describe, expect, it } from "vitest";
import { calculateWorkflowUnits, canonicalCommercialPlanCode, capacityPackPurchaseAllowed, COMMERCIAL_PLAN_CAPACITY } from "./commercial-capacity.js";

describe("DEV-059 commercial capacity policy", () => {
  it("maps legacy plan names to the three canonical commercial plans", () => {
    expect(canonicalCommercialPlanCode("starter")).toBe("entrepreneur");
    expect(canonicalCommercialPlanCode("personal")).toBe("entrepreneur");
    expect(canonicalCommercialPlanCode("growth")).toBe("business");
    expect(canonicalCommercialPlanCode("pro")).toBe("agency");
    expect(COMMERCIAL_PLAN_CAPACITY).toMatchObject({ entrepreneur: 2_000, business: 5_000, agency: 18_000 });
  });

  it("prices keyword research once per batch plus country and local checks", () => {
    expect(calculateWorkflowUnits("keyword_research_batch", 1, {
      inputUnits: 40,
      metadata: { countryChecks: 20, localChecks: 20 },
      pricingModel: "keyword_market",
      pricingConfig: { baseUnits: 50, countryCheckUnits: 5, localCheckUnits: 15 },
    })).toBe(450);
  });

  it("does not charge approved page content again during website assembly", () => {
    expect(calculateWorkflowUnits("website_page_generate", 1, {
      inputUnits: 9,
      metadata: { pageCount: 9, imageCount: 11, mode: "website_generation" },
      pricingModel: "website",
      pricingConfig: { baseUnits: 250, perPageUnits: 25, perImageUnits: 25 },
    })).toBe(525);
    expect(calculateWorkflowUnits("website_page_generate", 1, {
      inputUnits: 18,
      metadata: { pageCount: 18, imageCount: 20, mode: "website_generation" },
      pricingModel: "website",
      pricingConfig: { baseUnits: 250, perPageUnits: 25, perImageUnits: 25 },
    })).toBe(750);
    expect(calculateWorkflowUnits("website_page_generate", 1, {
      inputUnits: 18,
      metadata: { pageCount: 18, imageCount: 20, mode: "website_generation", billPageContent: true },
      pricingModel: "website",
      pricingConfig: { baseUnits: 250, perPageUnits: 25, perImageUnits: 25 },
    })).toBe(1_200);
    expect(calculateWorkflowUnits("website_page_generate", 1, {
      inputUnits: 5,
      metadata: { pageCount: 5, mode: "content_generation" },
      pricingModel: "website",
      pricingConfig: { perPageUnits: 25 },
      minimumUnitCost: 25,
    })).toBe(125);
  });

  it("charges zero for deterministic growth recalculation and supports formula bounds", () => {
    expect(calculateWorkflowUnits("growth_diagnosis", 125, {
      metadata: { aiGenerated: false }, pricingModel: "ai_or_zero", pricingConfig: { deterministicUnits: 0 }, minimumUnitCost: 0,
    })).toBe(0);
    expect(calculateWorkflowUnits("backlink_snapshot", 1, {
      metadata: { domainCount: 100 }, pricingModel: "per_domain", pricingConfig: { perDomainUnits: 25 }, maximumUnitCost: 500,
    })).toBe(500);
    expect(calculateWorkflowUnits("strategy_generate", 450, { metadata: { cacheHit: true }, minimumUnitCost: 250 })).toBe(0);
  });

  it("unlocks Capacity Packs at the warning threshold so work is not interrupted", () => {
    expect(capacityPackPurchaseAllowed(1)).toBe(false);
    expect(capacityPackPurchaseAllowed(265, 20)).toBe(true);
    expect(capacityPackPurchaseAllowed(0)).toBe(true);
  });
});
