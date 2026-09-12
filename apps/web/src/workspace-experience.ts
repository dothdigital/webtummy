export type WorkspaceExperience = {
  kind: "personal" | "business" | "agency";
  workspaceLabel: string;
  canInviteTeam: boolean;
  canManageClients: boolean;
  canCreateProposals: boolean;
  reportsEyebrow: string;
  reportsTitle: string;
  reportsDescription: string;
};

export function workspaceExperience(workspaceType?: string | null): WorkspaceExperience {
  const normalized = String(workspaceType || "business").trim().toLowerCase();
  if (normalized === "agency") {
    return {
      kind: "agency",
      workspaceLabel: "Agency Workspace",
      canInviteTeam: true,
      canManageClients: true,
      canCreateProposals: true,
      reportsEyebrow: "Agency documents",
      reportsTitle: "Proposals & White-label Reports",
      reportsDescription: "Create versioned, evidence-backed client documents. Client delivery remains blocked until approval and document QA pass.",
    };
  }
  if (normalized === "personal" || normalized === "entrepreneur" || normalized === "individual") {
    return {
      kind: "personal",
      workspaceLabel: "Entrepreneur Workspace",
      canInviteTeam: false,
      canManageClients: false,
      canCreateProposals: false,
      reportsEyebrow: "Your project documents",
      reportsTitle: "Project Reports",
      reportsDescription: "Create and download evidence-backed reports for your own projects. Saved reports remain versioned and reviewable.",
    };
  }
  return {
    kind: "business",
    workspaceLabel: "Business Workspace",
    canInviteTeam: true,
    canManageClients: false,
    canCreateProposals: false,
    reportsEyebrow: "Business documents",
    reportsTitle: "Business Project Reports",
    reportsDescription: "Create and download evidence-backed reports for your business projects. Saved reports remain versioned and reviewable.",
  };
}
