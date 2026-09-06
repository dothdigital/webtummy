export function projectReadinessComplete(input: {
  intakeComplete: boolean;
  requiredDetailsComplete: boolean;
  downstreamEvidenceComplete: boolean;
}) {
  // Workflow milestones are monotonic. Once a selected opportunity, completed
  // keyword analysis, or Strategy exists, readiness was necessarily passed and
  // must not become current again because an AI-created project represents a
  // legacy profile field differently.
  return input.intakeComplete && (input.requiredDetailsComplete || input.downstreamEvidenceComplete);
}
