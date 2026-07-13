import { Link } from "react-router-dom";
import { Card } from "../components/ui.js";

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
    title: "Plan Management",
    description: "Create and maintain billing plans, article limits, pricing, and features.",
    to: "/admin/plans",
  },
  {
    title: "Billing",
    description: "Review your own billing access and subscription state.",
    to: "/billing",
  },
];

export default function AdminManagement() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Admin Management</h1>
        <p className="text-sm text-charcoal-500">Super-admin controls for users, workflow tasks, plans, and billing.</p>
      </div>

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
