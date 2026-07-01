import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { GuidedProject } from "../types.js";

export default function GuidedProjectReady() {
  const { id } = useParams();
  const [project, setProject] = useState<GuidedProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<{ project: GuidedProject }>(`/api/projects-v2/${id}`)
      .then((result) => setProject(result.project))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load project"));
  }, [id]);

  if (error) return <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>;
  if (!project) return <div className="text-slate-400">Loading project...</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="overflow-hidden p-8 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-5xl font-bold text-green-600">✓</div>
          <h1 className="mt-6 text-3xl font-bold text-slate-950">Your project is ready!</h1>
          <div className="mt-2 text-2xl font-bold text-brand-700">{project.name}</div>
          <p className="mt-2 text-sm text-slate-500">We’ve set things up and your project is ready to grow.</p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to={`/guided-projects/${project.id}`} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700">View Project Dashboard →</Link>
            <Link to={`/guided-projects/${project.id}`} className="inline-flex items-center justify-center rounded-lg border border-brand-200 bg-white px-5 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50">Generate My First Strategy</Link>
          </div>

          <div className="mt-8 rounded-xl border border-slate-200 text-left">
            <div className="border-b border-slate-100 px-5 py-4 text-base font-bold text-slate-950">What SEnuke AI will do next</div>
            <div className="divide-y divide-slate-100">
              {[
                ["Analyze Your Business & Industry", "We’ll analyze your site, competitors, and market to understand your landscape.", "Starting now"],
                ["Find High-Impact Opportunities", "Discover content gaps, keyword opportunities, and backlink prospects.", "Queued"],
                ["Generate Your First Strategy", "Build a personalized SEO roadmap aligned to your goals.", "Queued"],
                ["Track & Improve Performance", "We’ll monitor progress and surface insights to keep you ahead.", "Queued"],
              ].map(([title, text, status]) => (
                <div key={title} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 font-bold text-brand-700">✦</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900">{title}</div>
                    <p className="mt-1 text-sm text-slate-500">{text}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{status}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-8">
          <h2 className="text-lg font-bold text-slate-950">Your Next Steps Roadmap</h2>
          <div className="mt-6 space-y-8">
            {[
              ["Explore Your Dashboard", "Get a high-level overview of your project’s performance, opportunities, and recent activity."],
              ["Generate Your First Strategy", "Let AI build a custom SEO strategy tailored to your business goals."],
              ["Review Top Opportunities", "See the highest-impact actions to improve rankings, traffic, and visibility."],
              ["Take Action & Grow", "Implement recommendations, track results, and scale what works."],
            ].map(([title, text], index) => (
              <div key={title} className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-600 bg-white font-bold text-brand-700">{index + 1}</div>
                <div>
                  <div className="font-bold text-slate-950">{title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-xl border border-brand-100 bg-brand-50 p-5">
            <div className="text-lg font-bold text-slate-950">You’re all set. Let’s build something amazing.</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">SEnuke AI is here to help you grow smarter, faster, and with confidence.</p>
          </div>
        </Card>
      </div>

      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-bold text-slate-950">Need help getting started?</div>
          <p className="mt-1 text-sm text-slate-500">Check out the quick start guide or schedule a call with our team.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost">View Quick Start Guide</Button>
          <Button variant="ghost">Schedule a Call</Button>
        </div>
      </Card>
    </div>
  );
}
