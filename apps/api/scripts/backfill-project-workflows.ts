import { prisma } from "@webtummy/db";
import { getProjectWorkflowController } from "../src/project-workflow-controller.js";

async function main() {
  const projects = await prisma.project.findMany({ where: { status: { not: "archived" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  let completed = 0;
  let failed = 0;
  for (const project of projects) {
    try {
      const workflow = await getProjectWorkflowController(project.id);
      if (!workflow) throw new Error("project not found during reconciliation");
      completed += 1;
      process.stdout.write(`Reconciled ${project.name} · ${workflow.stateLabel} · Brain v${workflow.businessBrainVersion} · Evidence v${workflow.evidenceVersion}\n`);
    } catch (error) {
      failed += 1;
      process.stderr.write(`Failed ${project.name}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  process.stdout.write(`Workflow backfill complete: ${completed} reconciled, ${failed} failed.\n`);
  if (failed) process.exitCode = 1;
}

await main().finally(() => prisma.$disconnect());
