import { describe, expect, it } from "vitest";
import { growthAccess } from "./growth-access.js";

describe("saved Growth workspace access", () => {
  it.each([
    [true, false, true, true, false, true],
    [false, true, true, true, false, true],
    [true, false, true, false, false, false],
    [true, true, false, true, false, false],
    [true, true, true, false, true, true],
  ])("foundation=%s intelligence=%s approved=%s blueprint=%s allows run=%s view=%s", (foundationReady, intelligenceReady, strategyApproved, hasBlueprint, canRun, canView) => {
    expect(growthAccess({ foundationReady, intelligenceReady, strategyApproved, hasBlueprint })).toEqual({ canRun, canView });
  });
});
