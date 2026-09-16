import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../api.js", () => ({ api: { post: vi.fn() } }));
import { FixedTermAccessNotice } from "./FixedTermAccessNotice.js";

describe("fixed-term upgrade notice", () => {
  it("shows the six-month upgrade with its own capacity and one-time price", () => {
    const html = renderToStaticMarkup(createElement(FixedTermAccessNotice, { access: { expired: true, endsAt: "2026-09-13T00:00:00Z", upgrade: { priceId: "six-month-price", name: "SEnuke AI Growth Advantage 6 Month Access", amountCents: 35900, currency: "USD", monthlyAiCapacity: 2000 } } }));
    expect(html).toContain("Further work is blocked");
    expect(html).toContain("$359.00 one-time payment");
    expect(html).toContain("2,000 AI units renewed each month");
    expect(html).toContain("Upgrade to 6 Month Access");
  });
});
