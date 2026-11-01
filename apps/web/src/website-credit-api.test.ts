import { beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  vi.stubGlobal("window", { addEventListener: vi.fn(), confirm: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
});
import { api } from "./api.js";
const quote = { pageCount: 10, billablePageCount: 10, includedPageCount: 0, creditsPerPage: 15, totalCredits: 150, signature: "signed", expiresAt: Date.now() + 60_000 };
const path = "/api/projects/project/website-builder/submit-development";
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); Object.defineProperty(window, "confirm", { configurable: true, writable: true, value: vi.fn() }); });
describe("website cost approval request flow", () => {
  it("asks approval for the server total before submitting generation", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "website_cost_confirmation_required", costEstimate: quote }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job" } }), { status: 202 }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(await api.post(path, { automaticSetup: true })).toEqual({ job: { id: "job" } });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Total credits to be used: 150"));
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetch.mock.calls[1]![1]!.body));
    expect(body).toMatchObject({ automaticSetup: true, pricingApproval: quote });
  });
  it("does not submit generation when the user cancels", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "website_cost_confirmation_required", costEstimate: quote }), { status: 409 }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await expect(api.post(path, {})).rejects.toThrow("No credits were used");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("requires confirmation again if Admin changes the rate", async () => {
    const updated = { ...quote, creditsPerPage: 20, totalCredits: 200, signature: "new-signature" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "website_cost_confirmation_required", costEstimate: quote }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify({ code: "website_cost_confirmation_required", costEstimate: updated }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job" } }), { status: 202 }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await api.post(path, {});
    expect(confirm).toHaveBeenNthCalledWith(2, expect.stringContaining("Total credits to be used: 200"));
  });
});
