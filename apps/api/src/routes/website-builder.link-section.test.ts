import { describe, expect, it } from "vitest";
import { websiteLinkSectionTargets } from "./website-builder.js";

describe("customer-selected link section destinations", () => {
  const pages = [{ id: "about", status: "approved" }, { id: "crm", status: "approved" }, { id: "location", status: "review" }, { id: "later", status: "deferred" }];
  it("allows active pages without recommendation or menu records", () => {
    expect(websiteLinkSectionTargets(pages, "about", ["crm", "location"])).toEqual(pages.slice(1, 3));
  });
  it("excludes self, deferred, and pages outside the website, and deduplicates", () => {
    expect(websiteLinkSectionTargets(pages, "about", ["about", "later", "other-site", "crm", "crm"])).toEqual([pages[1]]);
  });
});
