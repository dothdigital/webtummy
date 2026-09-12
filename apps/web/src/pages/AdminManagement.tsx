import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui.js";
import { GuidedSetup } from "./AgencyWorkspace.js";
import type { GuidedSetupStep } from "../workspace-dashboard.js";

const adminLinks = [
  {
    title: "Users",
    description: "Manage users, workspace RBAC roles, membership status, client access, passwords, and subscriptions.",
    to: "/users",
  },
  {
    title: "Task Management",
    description: "Choose between project-level tasks and module-level task management.",
    to: "/admin/tasks",
  },
  {
    title: "Project Tasks",
    description: "Manage project-level workflow tasks such as intake, opportunities, strategy, and execution plan.",
    to: "/admin/tasks/project",
  },
  {
    title: "Module Tasks",
    description: "Manage module execution tasks for sitemap, keywords, content, backlinks, citations, and publishing.",
    to: "/admin/tasks/module",
  },
  {
    title: "Automation Center",
    description: "Review automation coverage, approval rules, safety policies, and task audit logs across modules.",
    to: "/admin/automation",
  },
  {
    title: "Usage & Cost Controls",
    description: "Manage feature costs, plan limits, credit controls, budget caps, and model routing.",
    to: "/admin/usage-controls",
  },
  {
    title: "Commercial Admin",
    description: "Manage JVZoo mappings, versioned plans and policies, workspace subscriptions, entitlements, reconciliation, and audit history.",
    to: "/admin/commercial",
  },
  {
    title: "Legacy Plan Management",
    description: "Compatibility controls for the earlier client-level plan records during the workspace commercial migration.",
    to: "/admin/plans",
  },
  {
    title: "Billing",
    description: "Review your own billing access and subscription state.",
    to: "/billing",
  },
];

export default function AdminManagement() {
  const [showOnboardingPreview, setShowOnboardingPreview] = useState(false);
  const previewSteps: GuidedSetupStep[] = [
    { key: "project", title: "Create your first project", detail: "Create or select the business project that setup should use.", state: "complete", href: "/admin" },
    { key: "profile", title: "Complete your Business Profile", detail: "Confirm the business identity, offer, audience, goals and target markets.", state: "in_progress", href: "/admin" },
    { key: "evidence", title: "Connect relevant accounts", detail: "Review website, analytics, search, local and publishing evidence. Optional connections may be deferred.", state: "not_started", href: "/admin" },
    { key: "governance", title: "Understand AI Capacity and approvals", detail: "Review the estimate before chargeable work and how protected actions pause for approval.", state: "not_started", href: "/admin" },
    { key: "strategy", title: "Review your Strategy", detail: "Review and approve the evidence-backed Strategy version that controls execution.", state: "not_started", href: "/admin" },
    { key: "nba", title: "Complete your first Next Best Action", detail: "Open the one validated priority, understand why it comes first, then continue with its required approval.", state: "not_started", href: "/admin" },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Admin Management</h1><p className="text-sm text-charcoal-500">Super-admin controls for users, workflow tasks, plans, and billing.</p></div>
        <button type="button" onClick={() => setShowOnboardingPreview((current) => !current)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5 py-3 text-sm font-bold text-white hover:bg-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-200">{showOnboardingPreview ? "Close onboarding preview" : "Preview guided onboarding"}</button>
      </div>

      {showOnboardingPreview && <section className="space-y-3"><div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><b>Admin preview only.</b> This sample does not change customer setup, create records, run AI, or consume AI Capacity.</div><GuidedSetup steps={previewSteps} preview /></section>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {adminLinks.map((item) => (
          <Link key={item.to} to={item.to} className="block">
            <Card className="flex min-h-[150px] flex-col justify-between p-5 transition hover:border-brand-200 hover:shadow-md">
              <div>
                <div className="text-lg font-bold text-charcoal-950">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-charcoal-500">{item.description}</p>
              </div>
              <div className="mt-4 text-sm font-bold text-brand-600">Open →</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
