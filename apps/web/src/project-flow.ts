import type { GuidedProject, Website } from "./types.js";

export function projectHasWebsite(project?: GuidedProject, website?: Website | null) {
  return Boolean(project?.websiteId || project?.websiteUrl || project?.website || website);
}

export function isExistingWebsiteFlow(project?: GuidedProject, website?: Website | null) {
  if (!project) return false;
  if (project.websiteStatus) return project.websiteStatus === "existing_website";
  return project.projectType === "existing_website";
}

export function requiresSiteAnalysisBeforeStrategy(project?: GuidedProject, website?: Website | null) {
  return Boolean(project && isExistingWebsiteFlow(project, website) && projectHasWebsite(project, website));
}

export function workflowStatus(project: GuidedProject, key: string) {
  return project.workflowSteps?.find((step) => step.stepKey === key)?.status;
}

export function workflowStepComplete(project: GuidedProject, key: string) {
  return ["completed", "skipped"].includes(workflowStatus(project, key) ?? "");
}

export function nextProjectFlowStep(project: GuidedProject) {
  const latestStrategy = project.strategyPlans?.[0] as { status?: string } | undefined;
  const hasStrategy = Boolean(latestStrategy || project._count?.strategyPlans);
  const strategyApproved = (project.strategyPlans?.some((strategy) => strategy.status === "approved") ?? false) || workflowStepComplete(project, "strategy_approval");
  const siteAnalysisRequired = requiresSiteAnalysisBeforeStrategy(project);
  const hasWebsite = projectHasWebsite(project);

  if (!workflowStepComplete(project, "keyword_analysis")) {
    return {
      title: "Complete Keyword Intelligence",
      description: "SEnuke AI - AI Growth Operating System will discover and validate primary, supporting, long-tail, question, commercial, and local search directions, then evaluate intent, demand, competition, topic clusters, entities, AI-search opportunities, and page direction. A new website does not require a crawl for this step.",
      actionLabel: "Start Keyword Intelligence",
      to: `/keywords?projectId=${project.id}`,
      badge: "Step 3: Keyword Intelligence",
    };
  }
  if (siteAnalysisRequired && !workflowStepComplete(project, "site_analysis")) {
    return {
      title: "Run Site Analysis",
      description: "Because this project has an existing website, SEnuke AI - AI Growth Operating System should crawl the site before strategy so the plan uses real page, SEO, internal link, speed, CTA, and indexability data.",
      actionLabel: "Analyze Site",
      to: `/site-analysis?projectId=${project.id}`,
      badge: "Step 4: Site Analysis",
    };
  }
  if (!hasStrategy) {
    return {
      title: "Generate Strategy",
      description: "Keyword discovery and required site analysis are ready. SEnuke AI - AI Growth Operating System can now generate the strategy using the opportunity, keyword data, site data, business goal, and user path.",
      actionLabel: "Generate Strategy",
      to: `/strategy?projectId=${project.id}`,
      badge: "Step 5: Strategy",
    };
  }
  if (!strategyApproved) {
    return {
      title: "Review Strategy Draft",
      description: "A strategy draft exists. Review and approve it before creating the full prioritized SEO/Growth execution plan.",
      actionLabel: "Review Strategy",
      to: `/strategy?projectId=${project.id}`,
      badge: "Step 5: Strategy Review",
    };
  }
  if (workflowStepComplete(project, "execution_plan")) {
    return isExistingWebsiteFlow(project)
      ? {
          title: "Continue Execution",
          description: "Keyword analysis, Strategy, and the Execution Plan are complete. Continue with the next ready project task.",
          actionLabel: "Open Execution Plan",
          to: `/guided-projects/${project.id}?tab=execution#execution-tasks`,
          badge: "Execution ready",
        }
      : {
          title: "Build the Approved Website",
          description: "Keyword analysis, Strategy, and the Execution Plan are complete. Continue with the approved page map, content, and website build.",
          actionLabel: "Open Site Architect",
          to: `/site-architect?projectId=${project.id}`,
          badge: "Website build ready",
        };
  }
  return {
    title: "Create Execution Plan",
    description: "The strategy is approved. SEnuke AI - AI Growth Operating System can now create the full prioritized execution plan with the right execution modules based on campaign type, readiness data, and strategy recommendations.",
    actionLabel: "Create Execution Plan",
    to: `/strategy?projectId=${project.id}`,
    badge: "Step 6: Execution Plan",
  };
}
