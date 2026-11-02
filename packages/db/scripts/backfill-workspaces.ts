import { prisma } from "../src/index.js";

const normalizeName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

async function backfillTenant(tenantId: string) {
  const tenant = await prisma.client.findUnique({
    where: { id: tenantId },
    include: {
      users: { orderBy: { createdAt: "asc" } },
      projects: { orderBy: { createdAt: "asc" }, include: { website: true } },
    },
  });
  if (!tenant) return { tenantId, status: "missing" };
  const activeUsers = tenant.users.filter((user) => user.isActive);
  const internalOwnerId = tenant.contactEmail?.match(/^internal\+([^@]+)@senuke-ai\.local$/)?.[1];
  const fallbackOwner = internalOwnerId
    ? await prisma.user.findFirst({ where: { id: internalOwnerId, isActive: true } })
    : await prisma.user.findFirst({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
  const owner = activeUsers.find((user) => user.role === "client_admin") ?? activeUsers[0] ?? fallbackOwner;
  if (!owner) return { tenantId, status: "skipped_no_active_owner" };
  const usersToMigrate = tenant.users.some((user) => user.id === owner.id) ? tenant.users : [...tenant.users, owner];
  // Existing legacy tenants are treated as agencies during the DEV-002 rollout.
  // This is idempotent: AgencyClient records are reused before legacy projects are linked.
  const workspaceType = "agency";

  const result = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.upsert({
      where: { legacyClientId: tenant.id },
      create: { legacyClientId: tenant.id, name: tenant.name, workspaceType, ownerUserId: owner.id },
      update: { workspaceType, ownerUserId: owner.id },
    });
    await tx.workspaceMemberRole.deleteMany({ where: { role: "owner", membership: { workspaceId: workspace.id, userId: { not: owner.id } } } });
    let memberships = 0;
    for (const user of usersToMigrate) {
      const membership = await tx.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
        create: {
          workspaceId: workspace.id, userId: user.id,
          status: user.isActive ? "active" : "deactivated",
          joinedAt: user.isActive ? user.createdAt : null,
          deactivatedAt: user.isActive ? null : new Date(),
        },
        update: {},
      });
      const roles = user.id === owner.id ? (workspaceType === "personal" ? ["owner"] : ["owner", "admin"]) : user.role === "client_admin" ? (workspaceType === "personal" ? ["editor"] : ["admin"]) : ["viewer"];
      for (const role of roles) {
        await tx.workspaceMemberRole.upsert({
          where: { membershipId_role: { membershipId: membership.id, role } },
          create: { membershipId: membership.id, role, grantedById: owner.id },
          update: {},
        });
      }
      memberships += 1;
    }

    let agencyClients = 0;
    let linkedProjects = 0;
    if (workspaceType === "agency") {
      const grouped = new Map<string, typeof tenant.projects>();
      for (const project of tenant.projects.filter((item) => !item.agencyClientId)) {
        const clientName = project.businessName?.trim() || project.name.trim();
        const key = normalizeName(clientName);
        grouped.set(key, [...(grouped.get(key) ?? []), project]);
      }
      for (const [normalizedName, projects] of grouped) {
        const name = projects[0].businessName?.trim() || projects[0].name.trim();
        const websites = [...new Set(projects.flatMap((project) => [project.website?.rootUrl, project.websiteUrl].filter((url): url is string => Boolean(url))))];
        const locations = [...new Set(projects.flatMap((project) => {
          const targets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [];
          return [project.businessLocation, ...targets].filter((location): location is string => Boolean(location));
        }))];
        const agencyClient = await tx.agencyClient.upsert({
          where: { workspaceId_normalizedName: { workspaceId: workspace.id, normalizedName } },
          create: {
            workspaceId: workspace.id, name, normalizedName, createdById: owner.id,
            websites, businessLocations: locations, targetMarkets: locations,
            defaultSettings: { migratedFromLegacyProjects: true },
          },
          update: {},
        });
        await tx.project.updateMany({
          where: { id: { in: projects.map((project) => project.id) } },
          data: { agencyClientId: agencyClient.id, businessName: null },
        });
        agencyClients += 1;
        linkedProjects += projects.length;
      }
    }
    const existingEvent = await tx.workspaceActivity.findFirst({
      where: { workspaceId: workspace.id, action: "workspace.legacy_backfill_completed", entityId: workspace.id },
    });
    if (!existingEvent) await tx.workspaceActivity.create({
      data: {
        workspaceId: workspace.id, actorUserId: owner.id, action: "workspace.legacy_backfill_completed",
        entityType: "workspace", entityId: workspace.id,
        metadataJson: { tenantId: tenant.id, memberships, agencyClients, linkedProjects },
      },
    });
    return { workspaceId: workspace.id, memberships, agencyClients, linkedProjects };
  });
  return { tenantId, status: "migrated", ...result };
}

async function main() {
  const tenantIds = await prisma.client.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
  const results = [];
  for (const tenant of tenantIds) {
    const result = await backfillTenant(tenant.id);
    results.push(result);
    console.info(JSON.stringify(result));
  }
  const skipped = results.filter((result) => result.status !== "migrated");
  console.info(JSON.stringify({ tenants: results.length, migrated: results.length - skipped.length, skipped: skipped.length }));
  if (skipped.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
