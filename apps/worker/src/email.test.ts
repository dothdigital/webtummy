import { describe, expect, it } from "vitest";
import { configuredMailProvider } from "./email.js";

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
