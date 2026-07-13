import { expect, test } from "vitest";
import { validateProjectCreation, websiteStatuses } from "./dev003.js";

const valid = {
  name: "Summer campaign", projectType: "existing_website", primaryGoal: "More leads",
  websiteStatus: "existing_website", websiteUrl: "https://example.com",
  businessLocation: "Toronto, Canada", targetLocations: ["Canada"],
};

test("DEV-003 accepts every direct-workspace website status and only requires an existing URL", () => {
  for (const websiteStatus of websiteStatuses) {
    const errors = validateProjectCreation({ ...valid, websiteStatus, websiteUrl: websiteStatus === "existing_website" ? valid.websiteUrl : "" }, "business");
    expect(errors).toEqual([]);
  }
});

test("DEV-003 enforces all required fields", () => {
  const errors = validateProjectCreation({}, "business");
  expect(errors).toHaveLength(6);
  expect(errors.join(" ")).toMatch(/Project Name/);
  expect(errors.join(" ")).toMatch(/Target Market/);
});

test("DEV-003 requires a client in Agency Workspace", () => {
  expect(validateProjectCreation(valid, "agency").join(" ")).toMatch(/require a Client/);
  expect(validateProjectCreation({ ...valid, agencyClientId: "client-1" }, "agency")).toEqual([]);
});

test("DEV-003 keeps Business Location separate from multiple Target Markets", () => {
  expect(validateProjectCreation({ ...valid, businessLocation: "Toronto HQ", targetLocations: ["Canada", "United States"] }, "ecommerce")).toEqual([]);
  expect(validateProjectCreation({ ...valid, targetLocations: [] }, "personal").join(" ")).toMatch(/Target Market/);
});
