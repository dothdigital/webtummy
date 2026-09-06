export const publishingTargets = ["wordpress", "html", "shopify", "social"] as const;
export type PublishingTarget = (typeof publishingTargets)[number];

export type PublishingCandidate = {
  target: PublishingTarget;
  approvedAt?: Date | string | null;
  autoApprovalEnabled?: boolean;
  clientApprovalRequired?: boolean;
  clientApprovedAt?: Date | string | null;
  dependenciesComplete?: boolean;
  targetReference?: string | null;
};

export function publishingValidationErrors(candidate: PublishingCandidate) {
  const errors: string[] = [];
  if (!candidate.approvedAt && !candidate.autoApprovalEnabled) errors.push("Approval is required before publishing.");
  if (candidate.clientApprovalRequired && !candidate.clientApprovedAt) errors.push("Client approval is required before publishing.");
  if (candidate.dependenciesComplete === false) errors.push("Publishing dependencies are incomplete.");
  if (!candidate.targetReference?.trim()) errors.push(`A ${candidate.target} target reference is required.`);
  if (candidate.target === "html" && candidate.targetReference && !/^https?:\/\//i.test(candidate.targetReference)) errors.push("HTML publishing requires a verifiable deployment URL.");
  return errors;
}

export type PublishingVerification = {
  status: "verified" | "pending" | "failed";
  externalId?: string | null;
  liveUrl?: string | null;
  checksum?: string | null;
  error?: string | null;
};

/**
 * A small, module-agnostic contract used by every feature that hands work to
 * Publishing. Source modules keep ownership of research and generation;
 * Publishing owns review, approval, delivery and verification.
 */
export type PublishingWorkflowCandidate = {
  moduleName?: string | null;
  sourceType?: string | null;
  status?: string | null;
  relatedAssetId?: string | null;
  approvalSnapshotJson?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isPublishingWorkflowCandidate(candidate: PublishingWorkflowCandidate) {
  const snapshot = record(candidate.approvalSnapshotJson);
  const publishingWorkflow = record(snapshot.publishingWorkflow);
  const generatedContent = record(snapshot.generatedContent);
  return publishingWorkflow.enabled === true
    || candidate.moduleName === "publishing"
    || Boolean(candidate.relatedAssetId)
    || Boolean(generatedContent.generationId)
    || ["ready_to_publish", "publishing", "published"].includes(candidate.status ?? "");
}

export function publishingSourceLabel(candidate: Pick<PublishingWorkflowCandidate, "moduleName" | "sourceType">) {
  const source = `${candidate.moduleName ?? ""} ${candidate.sourceType ?? ""}`.toLowerCase();
  if (source.includes("seo_fix") || source.includes("gap_analysis") || source.includes("site_analysis")) return "SEO update";
  if (source.includes("local_seo")) return "Local SEO";
  if (source.includes("citation")) return "AI Citation";
  if (source.includes("lead_magnet")) return "Lead magnet";
  if (source.includes("growth")) return "Growth";
  if (source.includes("social")) return "Social";
  if (source.includes("website")) return "Website";
  return "Content";
}

export function publishingState(verification: PublishingVerification) {
  if (verification.status === "verified") return "published" as const;
  if (verification.status === "failed") return "ready_to_publish" as const;
  return "publishing" as const;
}
