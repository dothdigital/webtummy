import { describe, expect, it } from "vitest";
import { actionEmail, configuredMailProvider } from "./email.js";

describe("configuredMailProvider", () => {
  it("uses SES with an AWS region and instance-role credentials", () => {
    expect(configuredMailProvider({
      emailProvider: "",
      resendApiKey: "",
      awsRegion: "ca-central-1",
      awsAccessKeyId: "",
    })).toBe("ses");
  });

  it("honors an explicitly selected provider", () => {
    expect(configuredMailProvider({
      emailProvider: "resend",
      resendApiKey: "key",
      awsRegion: "ca-central-1",
      awsAccessKeyId: "",
    })).toBe("resend");
  });

  it("uses development logging when no mail service is configured", () => {
    expect(configuredMailProvider({
      emailProvider: "",
      resendApiKey: "",
      awsRegion: "",
      awsAccessKeyId: "",
    })).toBe("development");
  });
});

it("builds an action email with a CTA and branded signature", () => {
  const email = actionEmail({ title: "Work is ready", message: "Review the generated content.", ctaLabel: "Review now", ctaUrl: "https://app.senuke.com/review" });
  expect(email.text).toContain("Review now: https://app.senuke.com/review");
  expect(email.text).toContain("The SEnuke AI Team");
  expect(email.html).toContain(">Review now</a>");
});
