import { describe, expect, it, vi } from "vitest";
import { loadSocialProjectContext, socialProjectId } from "./social-project-context.js";

describe("Social project context", () => {
  const kpiry = { id: "kpiry", websiteId: "site", name: "KPIRY" };
  it("uses Social selection, URL, then workspace in that order", () => {
    expect(socialProjectId("selected", "url", "workspace")).toBe("selected");
    expect(socialProjectId("", "url", "workspace")).toBe("url");
    expect(socialProjectId(null, null, "workspace")).toBe("workspace");
    expect(socialProjectId("", "", "")).toBeNull();
  });
  it.each(["direct URL", "sidebar URL"])("resolves a %s even when project options are empty", async () => {
    const get = vi.fn(async () => kpiry);
    const context = await loadSocialProjectContext("kpiry", get, async () => []);
    expect(get).toHaveBeenCalledWith("kpiry");
    expect(context).toEqual({ project: kpiry, projects: [kpiry] });
  });
  it("does not let a list failure discard a directly fetched project", async () => {
    expect((await loadSocialProjectContext("kpiry", async () => kpiry, async () => { throw new Error("list unavailable"); })).project).toBe(kpiry);
  });
  it("does not silently switch to a different project when direct access fails", async () => {
    await expect(loadSocialProjectContext("kpiry", async () => { throw new Error("Project not found"); }, async () => [{ ...kpiry, id: "other" }])).rejects.toThrow("Project not found");
  });
  it("waits for direct project data before resolving an empty list", async () => {
    let resolve!: (value: typeof kpiry) => void;
    const direct = new Promise<typeof kpiry>((done) => { resolve = done; });
    const ready = vi.fn();
    const result = loadSocialProjectContext("kpiry", () => direct, async () => []).then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    resolve(kpiry);
    await result;
    expect(ready).toHaveBeenCalledWith({ project: kpiry, projects: [kpiry] });
  });
});
