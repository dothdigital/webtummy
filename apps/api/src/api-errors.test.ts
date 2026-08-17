import { describe, expect, it } from "vitest";
import { GENERIC_SYSTEM_ERROR, isGenericInternalError, systemErrorPayload } from "./api-errors.js";

describe("platform API error responses", () => {
  it("replaces generic internal errors with a support-safe response", () => {
    expect(systemErrorPayload({ error: "internal server error" }, "SEN-TEST-1234", "support@senuke.ai")).toEqual({
      error: GENERIC_SYSTEM_ERROR,
      errorCode: "SEN-TEST-1234",
      supportEmail: "support@senuke.ai",
    });
  });

  it("preserves an intentional public failure message and adds its support reference", () => {
    expect(systemErrorPayload({ error: "Report generation failed. Please retry." }, "SEN-TEST-5678", "support@senuke.ai", true)).toMatchObject({
      error: "Report generation failed. Please retry.",
      errorCode: "SEN-TEST-5678",
      supportEmail: "support@senuke.ai",
    });
  });

  it("recognizes generic internal-error text without matching useful messages", () => {
    expect(isGenericInternalError("Internal server error.")).toBe(true);
    expect(isGenericInternalError("The provider returned an error")).toBe(false);
  });
});
