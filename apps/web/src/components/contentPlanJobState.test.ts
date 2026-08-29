import { describe, expect, it } from "vitest";
import { contentPlanJobAction, contentPlanJobFailureMessage } from "./contentPlanJobState.js";

describe("Website Plan generation job UI state", () => {
  it("shows an immediately returned failed job instead of waiting for polling", () => {
    const job = {
      status: "failed",
      error: "We could not complete Website Plan generation.",
      errorCode: "SEN-20260810-C394EB8A",
    };

    expect(contentPlanJobAction(job)).toBe("show_failure");
    expect(contentPlanJobFailureMessage(job)).toBe(
      "We could not complete Website Plan generation. Error code: SEN-20260810-C394EB8A",
    );
  });

  it("fetches the saved plan when an already-completed job is returned", () => {
    expect(contentPlanJobAction({ status: "completed" })).toBe("fetch_result");
  });

  it("does not repeat an error code already included in the public failure message", () => {
    const publicMessage = "We could not complete Website Plan generation. Send error code SEN-20260810-C394EB8A to support.";
    expect(contentPlanJobFailureMessage({
      status: "failed",
      error: publicMessage,
      errorCode: "SEN-20260810-C394EB8A",
    })).toBe(publicMessage);
  });

  it("does not present governed prerequisites as support errors", () => {
    expect(contentPlanJobFailureMessage({
      status: "failed",
      error: "Complete the Growth Plan from the approved Strategy before preparing the SEO Plan.",
      errorCode: "SEN-20260828-18AA94E8",
    })).toBe("Complete the Growth Plan from the approved Strategy before preparing the SEO Plan.");
  });

  it("polls only active generation jobs", () => {
    expect(contentPlanJobAction({ status: "queued" })).toBe("poll");
    expect(contentPlanJobAction({ status: "running" })).toBe("poll");
    expect(contentPlanJobAction({ status: "cancelled" })).toBe("show_unexpected_status");
  });
});
