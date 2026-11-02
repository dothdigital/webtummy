export type ConnectedCoverageCta = { steps: string; route: string; label: string };

export function connectedCoverageCta(message: string, workflowDestination: string, projectId: string): ConnectedCoverageCta {
  const project = encodeURIComponent(projectId);
  const destination = workflowDestination.replace("{projectId}", project);
  if (/approved content roadmap/i.test(message)) return { steps: message, route: `/ai-content?projectId=${project}`, label: "Create Content Roadmap" };
  if (/internal-link inventory|linking tasks|internal-link graph/i.test(message)) return { steps: message, route: `/site-analysis?projectId=${project}`, label: "Review Internal-Link Opportunities" };
  if (/AI Citation analysis|entity and source-readiness/i.test(message)) return { steps: message, route: `/ai-citations?projectId=${project}&tab=overview`, label: "Run AI Citation Analysis" };
  if (/Create the Local SEO business profile/i.test(message)) return { steps: message, route: `/local-seo?projectId=${project}&editProfile=1#business-profile`, label: "Create Local SEO Profile" };
  if (/Connect the authorized Google Business Profile/i.test(message)) return { steps: message, route: `/local-seo?projectId=${project}&editProfile=1#business-profile`, label: "Connect Google Business Profile" };
  if (/Connect Google Business Profile before/i.test(message)) return { steps: message, route: `/local-seo?projectId=${project}#business-profile`, label: "Connect Google Business Profile" };
  if (/Run the Local SEO audit/i.test(message)) return { steps: message, route: `/local-seo?projectId=${project}`, label: "Run Local SEO Audit" };
  if (/Authority Growth analysis|backlink baseline/i.test(message)) return { steps: message, route: `/backlinks?projectId=${project}`, label: "Run Authority Growth Analysis" };
  if (/Generate and approve the Unified Strategy/i.test(message)) return { steps: message, route: `/strategy?projectId=${project}`, label: "Generate Unified Strategy" };
  if (/No approved publish receipt/i.test(message)) return { steps: message, route: `/ai-content?projectId=${project}&tab=publishing`, label: "Open Publishing Queue" };
  if (/Post-publish verification begins/i.test(message)) return { steps: message, route: `/ai-content?projectId=${project}&tab=publishing`, label: "Review Publishing & Verification" };
  if (/observation|observed engine result|measured visibility/i.test(message)) return { steps: "Open AI Monitoring, save a question prompt if needed, perform a permitted manual/provider check, then save the observed answer, brand mention, accuracy and cited source URLs.", route: `/ai-citations?projectId=${project}&tab=monitoring`, label: "Open AI Monitoring" };
  if (/answer engine|answer opportunities|question-led/i.test(message)) return { steps: "Run Citation Research, open Answer Opportunities, then add the relevant audience questions to monitoring. Saving at least one question-led prompt records the query evidence.", route: `/ai-citations?projectId=${project}&tab=answers`, label: "Open Answer Opportunities" };
  if (/generative|entities, claims|citation readiness/i.test(message)) return { steps: "Run Citation Research, review Entity & claims, approve or reject the extracted claims, and review the resulting Readiness findings. Rerun research after correcting missing website evidence.", route: `/ai-citations?projectId=${project}&tab=overview`, label: "Open Citation Research" };
  const routeLabel = destination.startsWith("/site-analysis") ? "Open Site Analysis"
    : destination.startsWith("/gap-analysis") ? "Open Gap Analysis"
      : destination.startsWith("/keyword-insights") ? "Open Keyword Intelligence"
        : destination.startsWith("/local-seo") ? "Open Local SEO"
          : destination.startsWith("/ai-citations") ? "Open AI Citations"
            : destination.startsWith("/backlinks") ? "Open Authority Growth"
              : destination.startsWith("/strategy") ? "Open Unified Strategy"
                : destination.startsWith("/ai-content") ? "Open Content Studio"
                  : "Open Required Workflow";
  return { steps: message, route: destination, label: routeLabel };
}
