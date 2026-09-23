// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api.js", () => ({ api: mocks }));
vi.mock("../components/GrowthSocialPlan.js", () => ({ default: () => null }));
import SocialStrategy from "./SocialStrategy.js";

let root: Root;
let host: HTMLDivElement;
let resolveProject: (value: unknown) => void;
const project = { id: "kpiry", name: "KPIRY", businessName: "KPIRY", websiteId: "site", websiteUrl: "https://kpiry.example" };
const response = { website: { id: "site" }, profiles: [], competitors: [], strategies: [], platformOptions: ["facebook"], contentSources: [], intelligence: { projectId: "kpiry", businessName: "KPIRY", keywords: ["approved KPIRY keyword"], targetMarkets: [], sourceCount: 0, sourceTypes: [] } };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  const pending = new Promise((resolve) => { resolveProject = resolve; });
  mocks.get.mockImplementation(async (url: string) => {
    if (url === "/api/projects-v2/kpiry") return pending;
    if (url === "/api/projects-v2") return { projects: [] };
    if (url === "/api/websites") return { websites: [] };
    if (url.startsWith("/api/social-strategy?")) return response;
    if (url === "/api/social-connect/accounts") return { accounts: [] };
    throw new Error(`Unexpected URL ${url}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(text: string) {
  const scope = host.querySelector('[role="dialog"]') ?? host;
  const button = [...scope.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}
async function mount() { await act(async () => root.render(<MemoryRouter initialEntries={["/social-strategy?projectId=kpiry"]}><SocialStrategy /></MemoryRouter>)); }
async function loaded() { await act(async () => resolveProject({ project })); }

it.each(["before", "after"])("preserves the campaign when opened %s project resolution, including a failed save", async (timing) => {
  await mount();
  expect(host.textContent).toContain("Loading project…");
  if (timing === "after") await loaded();
  await click("Create campaign strategy");
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  if (timing === "before") await loaded();
  expect(host.querySelector("select")?.value).toBe("kpiry");
  // The default values are valid; advance through the same modal steps as a user.
  await click("Next");
  await click("Next");
  expect(host.textContent).toContain("approved KPIRY keyword");
  await click("approved KPIRY keyword");
  mocks.post.mockRejectedValueOnce(new Error("Temporary database write failure"));
  await click("Add Campaign");
  expect(mocks.post).toHaveBeenCalledWith("/api/social-strategy/campaigns", expect.objectContaining({ projectId: "kpiry", websiteId: "site", targetKeywords: ["approved KPIRY keyword"] }));
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  expect(host.textContent).toContain("Temporary database write failure");
  expect(host.textContent).toContain("1 selected");
  const first = mocks.post.mock.calls[0][1];
  mocks.post.mockRejectedValueOnce(new Error("Temporary database write failure"));
  await click("Add Campaign");
  expect(mocks.post.mock.calls[1][1]).toEqual(first);
});
