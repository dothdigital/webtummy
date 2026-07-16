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

export function publishingState(verification: PublishingVerification) {
  if (verification.status === "verified") return "published" as const;
  if (verification.status === "failed") return "ready_to_publish" as const;
  return "publishing" as const;
}
