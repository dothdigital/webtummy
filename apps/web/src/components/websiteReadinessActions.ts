type ReadinessAction = { step: "review" | "optimization" | "structure" | "menus" | "media"; label: string; openForm?: boolean };

export function websiteReadinessAction(key: string): ReadinessAction {
  switch (key) {
    case "lead_form": return { step: "menus", label: "Set form recipient email", openForm: true };
    case "navigation": return { step: "menus", label: "Fix Navigation & Forms" };
    case "media": return { step: "media", label: "Review images & alt text" };
    case "approved_release": return { step: "review", label: "Review & approve website" };
    case "pages_present":
    case "unique_urls":
    case "technical_files":
    case "redirect_inventory": return { step: "structure", label: "Review Page Management" };
    default: return { step: "optimization", label: "Open Quality Review" };
  }
}
