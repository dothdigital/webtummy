import { describe, expect, it } from "vitest";
import { actionEmail, configuredMailProvider, notificationPresentation, notificationStatus } from "./email.js";

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
  const email = actionEmail({ title: "Work is ready", message: "Review the generated content.", ctaLabel: "Review now", ctaUrl: "https://app.senuke.com/review", previewText: "Review your completed work.", completedAt: "2026-08-25T16:30:00.000Z", preferencesUrl: "https://app.senuke.com/reports", supportEmail: "support@senuke.com" });
  expect(email.text).toContain("Review now: https://app.senuke.com/review");
  expect(email.text).toContain("The SEnuke AI Team");
  expect(email.text).toContain("Update recorded: 2026-08-25 16:30:00 UTC");
  expect(email.text).toContain("Manage notification preferences: https://app.senuke.com/reports");
  expect(email.html).toContain("Review your completed work.");
  expect(email.html).toContain(">Review now</a>");
});

it("selects a useful primary CTA for each notification family", () => {
  expect(notificationPresentation("strategy_approval_requested").ctaLabel).toBe("Review strategy");
  expect(notificationPresentation("site_architecture_ready").ctaLabel).toBe("Review architecture");
  expect(notificationPresentation("social_images_ready:campaign").ctaLabel).toBe("Review campaign assets");
  expect(notificationPresentation("growth-weekly:cycle").ctaLabel).toBe("View summary");
  expect(notificationPresentation("content_discovery_issue").ctaLabel).toBe("Fix discovery issue");
  expect(notificationPresentation("report_ready").ctaLabel).toBe("View report");
});

 it("does not call failed or pending work completed", () => {
   expect(notificationStatus("website_build_failed").label).toBe("Needs attention");
   expect(notificationStatus("strategy_approval_requested").label).toBe("Review required");
   expect(notificationStatus("report_ready:completed-id").label).toBe("Ready to review");
   expect(notificationStatus("unknown").label).toBe("Update");
 });
 it("keeps digest statuses and action destinations separate and escapes content", () => {
   const email = actionEmail({title:"Two updates",message:"",ctaLabel:"Open",ctaUrl:"https://app.senuke.com",updates:[
     {title:"<script>alert(1)</script>",message:"A & B",notificationType:"publishing_failed",ctaLabel:"Fix",ctaUrl:"javascript:alert(1)"},
     {title:"Report",message:"Ready",notificationType:"report_ready",ctaLabel:"View report",ctaUrl:"https://app.senuke.com/reports"},
   ]});
   expect(email.html).toContain("Needs attention");
   expect(email.html).toContain("Ready to review");
   expect(email.html).toContain('href="https://app.senuke.com/reports"');
   expect(email.html).not.toContain("<script>");
   expect(email.html).not.toContain("javascript:");
   expect(email.text).toContain("Next action");
   expect(email.html).not.toContain("Completed at");
 });
