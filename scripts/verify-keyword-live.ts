import { prisma } from "@webtummy/db";
import { signToken } from "../apps/api/src/auth.js";
import { keywordEvidenceList } from "../apps/api/src/keyword-evidence.js";
async function main() {
  const projectId = process.argv.find(arg => arg.startsWith("--project="))?.slice(10);
  if (!projectId) throw new Error("Pass --project=ID for the project whose live evidence should be verified");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { client: { include: { workspace: true } } } });
  const workspace = project.client.workspace;
  if (!workspace) throw new Error("Pilot workspace is unavailable");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: workspace.ownerUserId } });
  const token = signToken({ userId: user.id, role: user.role, clientId: user.clientId, sessionVersion: user.sessionVersion });
  const headers = { authorization: `Bearer ${token}`, "x-senuke-ai-workspace-id": workspace.id };
  const response = await fetch(`http://127.0.0.1:4000/api/keyword-research?projectId=${project.id}`, { headers });
  if (!response.ok) throw new Error(`Keyword list returned ${response.status}`);
  const body = await response.json() as any;
  const first = body.runs?.find((run: any) => run.ideas?.length);
  if (!first) throw new Error("No completed pilot report was returned");
  const detailResponse = await fetch(`http://127.0.0.1:4000/api/keyword-research/${first.id}`, { headers });
  const detail = await detailResponse.json() as any;
  if (!detailResponse.ok) throw new Error(`Keyword detail returned ${detailResponse.status}`);
  for (const idea of detail.run.ideas) {
    const checked = keywordEvidenceList([idea])[0];
    if (!checked || checked.avgMonthlySearches !== idea.avgMonthlySearches || !idea.classification) throw new Error("Live evidence contract mismatch");
  }
  const workflowResponse = await fetch(`http://127.0.0.1:4000/api/projects-v2/${project.id}/workflow-controller`, { headers });
  const workflow = await workflowResponse.json() as any;
  if (!workflowResponse.ok) throw new Error(`Workflow returned ${workflowResponse.status}`);
  console.log(JSON.stringify({ keywordListStatus: response.status, detailStatus: detailResponse.status, checkedIdeas: detail.run.ideas.length, workflowStatus: workflowResponse.status, nextBestAction: workflow.workflow?.nextBestAction?.title ?? workflow.nextBestAction?.title }, null, 2));
}
main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
