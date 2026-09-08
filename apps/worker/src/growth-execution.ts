import { prisma } from "@webtummy/db";
import { reconcileGrowthExecution } from "@webtummy/db/growth-execution";
let running = false;
export async function refreshGrowthExecutionPlans() {
  if (running) return;
  running = true;
  try {
    let cursor: string | undefined;
    while (true) {
      const projects = await prisma.project.findMany({ where: { status: "active", OR: [{ growthBlueprint: { isNot: null } }, { nextBestActions: { some: { sourceType: "growth_engine" } } }] }, orderBy: { id: "asc" }, take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true } });
      if (!projects.length) break;
      for (const project of projects) {
        try { await reconcileGrowthExecution(project.id, { notify: true }); }
        catch (error) { console.error(`[growth-execution] check failed for ${project.id}`, error); }
      }
      cursor = projects[projects.length - 1].id;
    }
  } finally { running = false; }
}
export function startGrowthExecutionScheduler() {
  const run = () => void refreshGrowthExecutionPlans().catch(error => console.error("[growth-execution] worker failed", error));
  const initial = setTimeout(run, 15000);
  const timer = setInterval(run, 5 * 60 * 1000);
  return () => { clearTimeout(initial); clearInterval(timer); };
}
