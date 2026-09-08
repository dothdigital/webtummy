import { prisma } from '@webtummy/db';
import { reconcileProjectPlanning } from '@webtummy/db/planning-reconciliation';
try {
  const projects = await prisma.project.findMany({select:{id:true}});
  const results = [];
  for (const project of projects) {
    const report = await reconcileProjectPlanning(project.id, process.argv.includes('--apply'));
    if (report.changes.length) results.push({projectId:project.id, changes:report.changes.map(item=>({id:item.id,title:item.title,reason:item.reason}))});
  }
  console.log(JSON.stringify({projectsScanned:projects.length,apply:process.argv.includes('--apply'),results},null,2));
} finally { await prisma.$disconnect(); }
