import { Prisma, prisma, type Client } from "@webtummy/db";
import { crawlQueue } from "./queue.js";
import { config } from "./config.js";
import { sendMail } from "./email.js";
import { approvalEscalationStage } from "@webtummy/core/approvals";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAYMENT_BLOCKED = new Set(["past_due", "incomplete", "incomplete_expired", "unpaid", "canceled"]);
const STALE_RUNNING_CRAWL_MS = 2 * 60 * 1000;
const STALE_QUEUED_CRAWL_MS = 60 * 60 * 1000;

function privateDiscoveryAddress(address: string) {
  if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return true;
  if (!isIP(address)) return true;
  if (address.includes(":")) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function safeDiscoveryUrl(raw: string) {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("URL is not publicly verifiable.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateDiscoveryAddress(entry.address))) throw new Error("URL resolves to a private or unsafe address.");
  return url;
}

function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function weekStart(date = new Date()) {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff));
}

function daysUntil(value: Date, now = new Date()) {
  return Math.ceil((value.getTime() - now.getTime()) / DAY_MS);
}

function hasAccess(client: Pick<Client, "aiSubscriptionStatus" | "trialEndsAt" | "manualAccessEndsAt" | "graceEndsAt">, now = new Date()) {
  if (client.aiSubscriptionStatus === "active") return true;
  if (PAYMENT_BLOCKED.has(client.aiSubscriptionStatus)) return false;
  if (client.aiSubscriptionStatus === "trialing" && client.trialEndsAt && client.trialEndsAt > now) return true;
  if (client.aiSubscriptionStatus === "offline" && client.manualAccessEndsAt && client.manualAccessEndsAt > now) return true;
  if (client.graceEndsAt && client.graceEndsAt > now) return true;
  return false;
}

async function runLogged<T extends Record<string, unknown>>(jobKey: string, action: () => Promise<T>) {
  const run = await prisma.maintenanceRun.create({ data: { jobKey, status: "running" } });
  try {
    const details = await action();
    await prisma.maintenanceRun.update({ where: { id: run.id }, data: { status: "completed", finishedAt: new Date(), detailsJson: details as Prisma.InputJsonValue } });
    return details;
  } catch (error) {
    await prisma.maintenanceRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: error instanceof Error ? error.stack ?? error.message : String(error) } });
    throw error;
  }
}

async function clientEmail(clientId: string, fallback: string | null) {
  const admin = await prisma.user.findFirst({
    where: { clientId, isActive: true, role: "client_admin" },
    orderBy: { createdAt: "asc" },
    select: { email: true, name: true },
  });
  return { email: admin?.email ?? fallback, name: admin?.name ?? null };
}

function appLink(path: string) {
  return `${config.webAppUrl.replace(/\/$/, "")}${path}`;
}

async function notifyClient(input: { clientId: string; fallbackEmail: string | null; subject: string; text: string; html: string }) {
  const recipient = await clientEmail(input.clientId, input.fallbackEmail);
  if (!recipient.email) return false;
  await sendMail({ to: recipient.email, subject: input.subject, text: input.text, html: input.html });
  return true;
}

export async function recoverQueuedCrawlJobs() {
  return runLogged("recover_queued_crawl_jobs", async () => {
    const staleStartedBefore = new Date(Date.now() - STALE_RUNNING_CRAWL_MS);
    const staleQueuedBefore = new Date(Date.now() - STALE_QUEUED_CRAWL_MS);
    const crawls = await prisma.crawlJob.findMany({
      where: {
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, status: true, createdAt: true },
    });

    let requeued = 0;
    let markedFailed = 0;
    let alreadyTracked = 0;
    const trackedStates = new Set(["active", "waiting", "delayed", "prioritized", "waiting-children"]);

    for (const crawl of crawls) {
      const existingJob = await crawlQueue.getJob(crawl.id);
      if (crawl.status === "queued" && crawl.createdAt < staleQueuedBefore) {
        await prisma.crawlJob.updateMany({
          where: { id: crawl.id, status: "queued" },
          data: { status: "failed", completedAt: new Date(), error: "Site analysis waited longer than 60 minutes and was stopped. Run Analyze Site again." },
        });
        if (existingJob && await existingJob.getState().catch(() => "unknown") !== "active") await existingJob.remove().catch(() => undefined);
        markedFailed++;
        continue;
      }
      if (existingJob) {
        const state = await existingJob.getState();
        if (trackedStates.has(state)) {
          alreadyTracked++;
          continue;
        }
        if (crawl.status === "running" && (state === "failed" || state === "completed")) {
          await prisma.crawlJob.updateMany({
            where: { id: crawl.id, status: "running" },
            data: {
              status: "failed",
              completedAt: new Date(),
              error: "Crawl worker job ended in BullMQ state " + state + " before the database status was finalized. Please run Analyze Site again.",
            },
          });
          markedFailed++;
          continue;
        }
        await existingJob.remove().catch(() => undefined);
      }

      if (crawl.status === "running") {
        await prisma.crawlJob.updateMany({
          where: { id: crawl.id, status: "running" },
          data: { status: "queued", startedAt: null, completedAt: null, error: null },
        });
      }
      await crawlQueue.add("crawl:start", { crawlJobId: crawl.id }, { jobId: crawl.id });
      requeued++;
    }

    return { requeued, markedFailed, alreadyTracked };
  });
}

export async function dailyBillingAccessSync() {
  return runLogged("daily_billing_access_sync", async () => {
    const now = new Date();
    const clients = await prisma.client.findMany({ where: { isActive: true } });
    let trialEndingSoon = 0;
    let trialExpired = 0;
    let paymentFailed = 0;
    let manualEndingSoon = 0;
    let manualExpired = 0;
    let subscriptionExpiring = 0;

    for (const client of clients) {
      if (client.aiSubscriptionStatus === "trialing" && client.trialEndsAt) {
        const days = daysUntil(client.trialEndsAt, now);
        if (days <= 3 && days > 0 && !client.trialEndingSoonNotifiedAt) {
          const sent = await notifyClient({
            clientId: client.id,
            fallbackEmail: client.contactEmail,
            subject: `Your SEnuke AI trial ends in ${days} day${days === 1 ? "" : "s"}`,
            text: `Your SEnuke AI trial ends in ${days} day${days === 1 ? "" : "s"}. Upgrade here: ${appLink("/pricing")}`,
            html: `<p>Your SEnuke AI trial ends in <strong>${days} day${days === 1 ? "" : "s"}</strong>.</p><p><a href="${appLink("/pricing")}">Choose a plan</a> to keep access active.</p>`,
          });
          if (sent) {
            await prisma.client.update({ where: { id: client.id }, data: { trialEndingSoonNotifiedAt: now } });
            trialEndingSoon += 1;
          }
        }
        if (client.trialEndsAt <= now && !client.trialExpiredNotifiedAt) {
          const sent = await notifyClient({
            clientId: client.id,
            fallbackEmail: client.contactEmail,
            subject: "Your SEnuke AI trial has expired",
            text: `Your SEnuke AI trial has expired. Choose a plan to continue: ${appLink("/pricing")}`,
            html: `<p>Your SEnuke AI trial has expired.</p><p><a href="${appLink("/pricing")}">Choose a plan</a> to continue using SEnuke AI.</p>`,
          });
          if (sent) {
            await prisma.client.update({ where: { id: client.id }, data: { trialExpiredNotifiedAt: now } });
            trialExpired += 1;
          }
        }
      }

      if (PAYMENT_BLOCKED.has(client.aiSubscriptionStatus) && !client.paymentFailedNotifiedAt) {
        const sent = await notifyClient({
          clientId: client.id,
          fallbackEmail: client.contactEmail,
          subject: "SEnuke AI payment was unsuccessful",
          text: `Your SEnuke AI payment was unsuccessful. Update or choose a plan here: ${appLink("/pricing?payment=unsuccessful")}`,
          html: `<p>Your SEnuke AI payment was unsuccessful.</p><p><a href="${appLink("/pricing?payment=unsuccessful")}">Choose a plan or retry payment</a> to restore access.</p>`,
        });
        if (sent) {
          await prisma.client.update({ where: { id: client.id }, data: { paymentFailedNotifiedAt: now } });
          paymentFailed += 1;
        }
      }

      if (client.aiSubscriptionStatus === "offline" && client.manualAccessEndsAt) {
        const days = daysUntil(client.manualAccessEndsAt, now);
        if (days <= 3 && days > 0 && !client.manualAccessEndingSoonNotifiedAt) {
          const sent = await notifyClient({
            clientId: client.id,
            fallbackEmail: client.contactEmail,
            subject: `Your SEnuke AI manual access ends in ${days} day${days === 1 ? "" : "s"}`,
            text: `Manual/offline SEnuke AI access ends in ${days} day${days === 1 ? "" : "s"}. Upgrade here: ${appLink("/pricing")}`,
            html: `<p>Manual/offline SEnuke AI access ends in <strong>${days} day${days === 1 ? "" : "s"}</strong>.</p><p><a href="${appLink("/pricing")}">Upgrade</a> to keep access active.</p>`,
          });
          if (sent) {
            await prisma.client.update({ where: { id: client.id }, data: { manualAccessEndingSoonNotifiedAt: now } });
            manualEndingSoon += 1;
          }
        }
        if (client.manualAccessEndsAt <= now && !client.manualAccessExpiredNotifiedAt) {
          const sent = await notifyClient({
            clientId: client.id,
            fallbackEmail: client.contactEmail,
            subject: "Your SEnuke AI manual access has expired",
            text: `Manual/offline SEnuke AI access has expired. Choose a plan here: ${appLink("/pricing")}`,
            html: `<p>Manual/offline SEnuke AI access has expired.</p><p><a href="${appLink("/pricing")}">Choose a plan</a> to restore access.</p>`,
          });
          if (sent) {
            await prisma.client.update({ where: { id: client.id }, data: { manualAccessExpiredNotifiedAt: now } });
            manualExpired += 1;
          }
        }
      }

      if (client.subscriptionCurrentPeriodEnd && client.aiSubscriptionStatus === "active") {
        const days = daysUntil(client.subscriptionCurrentPeriodEnd, now);
        if (days <= 3 && days > 0 && !client.subscriptionExpiringSoonNotifiedAt) {
          const sent = await notifyClient({
            clientId: client.id,
            fallbackEmail: client.contactEmail,
            subject: `Your SEnuke AI subscription renews in ${days} day${days === 1 ? "" : "s"}`,
            text: `Your SEnuke AI subscription period renews in ${days} day${days === 1 ? "" : "s"}. Manage billing: ${appLink("/billing")}`,
            html: `<p>Your SEnuke AI subscription period renews in <strong>${days} day${days === 1 ? "" : "s"}</strong>.</p><p><a href="${appLink("/billing")}">Manage billing</a>.</p>`,
          });
          if (sent) {
            await prisma.client.update({ where: { id: client.id }, data: { subscriptionExpiringSoonNotifiedAt: now } });
            subscriptionExpiring += 1;
          }
        }
      }
    }

    return { checked: clients.length, trialEndingSoon, trialExpired, paymentFailed, manualEndingSoon, manualExpired, subscriptionExpiring };
  });
}

export async function commercialLifecycleSync() {
  return runLogged("commercial_lifecycle_sync", async () => {
    const now = new Date();
    const graceExpired = await prisma.workspaceSubscription.findMany({
      where: { status: "past_due", graceEndsAt: { lte: now } },
      include: { workspace: true },
    });
    const retentionExpired = await prisma.workspaceSubscription.findMany({
      where: { status: { in: ["cancelled", "suspended"] }, retentionEndsAt: { lte: now } },
      include: { workspace: true },
    });
    const expiredReservations = await prisma.usageEvent.findMany({
      where: { status: "reserved", approvalTokenExpiresAt: { lte: now }, creditsReserved: { gt: 0 } },
      take: 500,
    });

    for (const subscription of graceExpired) {
      await prisma.$transaction(async (tx) => {
        await tx.workspaceSubscription.update({ where: { id: subscription.id }, data: { status: "read_only" } });
        await tx.workspace.update({ where: { id: subscription.workspaceId }, data: { commercialState: "read_only", accessMode: "read_only" } });
        if (subscription.workspace.legacyClientId) await tx.client.update({ where: { id: subscription.workspace.legacyClientId }, data: { aiSubscriptionStatus: "unpaid" } });
        await tx.commercialAuditEvent.create({ data: { workspaceId: subscription.workspaceId, actorType: "job", action: "commercial.grace_expired", reasonCode: "grace_period_elapsed", source: "job", beforeJson: { status: "past_due" }, afterJson: { status: "read_only" } } });
        await tx.workspaceNotification.create({ data: { workspaceId: subscription.workspaceId, userId: subscription.workspace.ownerUserId, type: "billing_read_only", title: "Workspace is now read-only", body: "The JVZoo payment grace period ended. Existing work remains available, but new AI, publishing, and automation actions are paused until the subscription is active.", actionUrl: "/billing", emailEligible: true } });
      });
    }

    for (const subscription of retentionExpired) {
      await prisma.$transaction(async (tx) => {
        await tx.workspaceSubscription.update({ where: { id: subscription.id }, data: { status: "deletion_scheduled" } });
        await tx.workspace.update({ where: { id: subscription.workspaceId }, data: { commercialState: "deletion_scheduled", accessMode: "read_only", deletionScheduledAt: now } });
        await tx.commercialRetentionCase.upsert({
          where: { id: `retention:${subscription.id}` },
          update: { state: "deletion_scheduled", deletionScheduledAt: now },
          create: { id: `retention:${subscription.id}`, workspaceId: subscription.workspaceId, policyVersionId: subscription.policyVersionId, state: "deletion_scheduled", retentionEndsAt: subscription.retentionEndsAt!, deletionScheduledAt: now },
        });
        await tx.commercialAuditEvent.create({ data: { workspaceId: subscription.workspaceId, actorType: "job", action: "commercial.retention_expired", reasonCode: "retention_period_elapsed", source: "job", beforeJson: { status: subscription.status }, afterJson: { status: "deletion_scheduled" } } });
        await tx.workspaceNotification.create({ data: { workspaceId: subscription.workspaceId, userId: subscription.workspace.ownerUserId, type: "deletion_scheduled", title: "Workspace deletion requires review", body: "The commercial retention period ended. Deletion has been scheduled but customer data has not been silently removed.", actionUrl: "/billing", emailEligible: true } });
      });
    }

    let reservationsReleased = 0;
    for (const reservation of expiredReservations) {
      const metadata = reservation.metadataJson && typeof reservation.metadataJson === "object" && !Array.isArray(reservation.metadataJson)
        ? reservation.metadataJson as Record<string, unknown>
        : {};
      const creditAccountId = typeof metadata.creditAccountId === "string" ? metadata.creditAccountId : null;
      const account = creditAccountId
        ? await prisma.creditAccount.findFirst({ where: { id: creditAccountId, clientId: reservation.clientId } })
        : await prisma.creditAccount.findFirst({ where: { clientId: reservation.clientId, status: "active" }, orderBy: { periodStart: "desc" } });
      if (!account) continue;
      await prisma.$transaction(async (tx) => {
        const released = await tx.usageEvent.updateMany({ where: { id: reservation.id, status: "reserved" }, data: { status: "refunded", refundedAt: now, error: "reservation expired" } });
        if (!released.count) return;
        const updated = await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { increment: reservation.creditsReserved } } });
        await tx.creditTransaction.create({ data: { clientId: reservation.clientId, usageEventId: reservation.id, type: "refund", amount: reservation.creditsReserved, balanceAfter: updated.balance, reason: "reservation expired" } });
        reservationsReleased += 1;
      });
    }
    return { graceExpired: graceExpired.length, retentionExpired: retentionExpired.length, reservationsReleased };
  });
}

export async function monthlyUsageReset() {
  return runLogged("monthly_usage_reset", async () => {
    const now = new Date();
    const periodStart = monthStart(now);
    const clients = await prisma.client.findMany({ where: { isActive: true } });
    let prepared = 0;
    for (const client of clients) {
      if (!hasAccess(client, now)) continue;
      await Promise.all([
        prisma.aiUsageCounter.upsert({
          where: { clientId_periodStart_type: { clientId: client.id, periodStart, type: "article" } },
          create: { clientId: client.id, periodStart, type: "article", count: 0, tokens: 0 },
          update: {},
        }),
        prisma.aiUsageCounter.upsert({
          where: { clientId_periodStart_type: { clientId: client.id, periodStart, type: "helper" } },
          create: { clientId: client.id, periodStart, type: "helper", count: 0, tokens: 0 },
          update: {},
        }),
      ]);
      await prisma.client.update({ where: { id: client.id }, data: { lastMonthlyUsageResetAt: now } });
      prepared += 1;
    }
    return { periodStart: periodStart.toISOString(), prepared };
  });
}

export async function monthlyScheduledAudit() {
  return runLogged("monthly_scheduled_audit", async () => {
    const now = new Date();
    const periodStart = monthStart(now);
    const clients = await prisma.client.findMany({
      where: { isActive: true, OR: [{ lastMonthlyAuditAt: null }, { lastMonthlyAuditAt: { lt: periodStart } }] },
      include: { websites: { where: { status: "active" }, include: { crawlJobs: { where: { status: { in: ["queued", "running"] } }, select: { id: true }, take: 1 } } } },
    });
    let queued = 0;
    for (const client of clients) {
      if (!hasAccess(client, now)) continue;
      const websiteLimit = Math.max(1, client.activeWebsiteLimit + client.extraWebsiteSlots);
      const websites = client.websites.slice(0, websiteLimit);
      for (const website of websites) {
        if (website.crawlJobs.length > 0) continue;
        const crawl = await prisma.crawlJob.create({ data: { websiteId: website.id, pageLimit: config.monthlyAuditPageLimit, maxDepth: config.monthlyAuditMaxDepth, options: { scheduled: true, periodStart: periodStart.toISOString() } } });
        await crawlQueue.add("crawl:start", { crawlJobId: crawl.id }, { jobId: crawl.id });
        queued += 1;
      }
      await prisma.client.update({ where: { id: client.id }, data: { lastMonthlyAuditAt: now } });
    }
    return { periodStart: periodStart.toISOString(), clientsChecked: clients.length, queued };
  });
}


export async function weeklyRankingReportGeneration() {
  return runLogged("weekly_ranking_report_generation", async () => {
    const now = new Date();
    const periodStart = weekStart(now);
    const clients = await prisma.client.findMany({
      where: {
        isActive: true,
        reportEmailEnabled: true,
        weeklyReportEmailEnabled: true,
        rankingChangeEmailEnabled: true,
        OR: [{ lastWeeklyReportAt: null }, { lastWeeklyReportAt: { lt: periodStart } }],
      },
      include: { websites: { select: { id: true, domain: true } } },
    });
    let emailed = 0;
    for (const client of clients) {
      if (!hasAccess(client, now)) continue;
      const runs = await prisma.keywordResearchRun.findMany({
        where: { clientId: client.id, status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, websiteId: true, seedKeyword: true, locationName: true, device: true, targetRank: true, manualRank: true, createdAt: true },
      });
      const groups = new Map<string, typeof runs>();
      for (const run of runs) {
        const key = [run.websiteId ?? "", run.seedKeyword.trim().toLowerCase(), run.locationName.trim().toLowerCase(), run.device].join("|");
        groups.set(key, [...(groups.get(key) ?? []), run]);
      }
      const movements = [...groups.values()].map((items) => {
        const sorted = items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const current = sorted[0];
        const previous = sorted[1];
        const currentRank = current ? current.manualRank ?? current.targetRank : null;
        const previousRank = previous ? previous.manualRank ?? previous.targetRank : null;
        return current && currentRank != null && previousRank != null ? { keyword: current.seedKeyword, currentRank, previousRank, change: currentRank - previousRank } : null;
      }).filter((item): item is { keyword: string; currentRank: number; previousRank: number; change: number } => Boolean(item && item.change !== 0));
      const topMovements = movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10);
      if (topMovements.length === 0) {
        await prisma.client.update({ where: { id: client.id }, data: { lastWeeklyReportAt: now } });
        continue;
      }
      const lines = topMovements.map((item) => `${item.change < 0 ? "Up" : "Down"} ${Math.abs(item.change)}: ${item.keyword} is now #${item.currentRank} (was #${item.previousRank})`);
      const sent = await notifyClient({
        clientId: client.id,
        fallbackEmail: client.contactEmail,
        subject: "Your weekly SEnuke AI ranking changes",
        text: [`Weekly ranking changes for ${client.name}:`, "", ...lines, "", `Open dashboard: ${appLink("/keyword-insights")}`].join("\n"),
        html: `<p>Weekly ranking changes for <strong>${client.name}</strong>:</p><ul>${topMovements.map((item) => `<li><strong>${item.change < 0 ? "Up" : "Down"} ${Math.abs(item.change)}</strong>: ${item.keyword} is now #${item.currentRank} (was #${item.previousRank})</li>`).join("")}</ul><p><a href="${appLink("/keyword-insights")}">Open keyword dashboard</a></p>`,
      });
      if (sent) emailed += 1;
      await prisma.client.update({ where: { id: client.id }, data: { lastWeeklyReportAt: now } });
    }
    return { periodStart: periodStart.toISOString(), clientsChecked: clients.length, emailed };
  });
}

export async function monthlyClientReportGeneration() {
  return runLogged("monthly_client_report_generation", async () => {
    const now = new Date();
    const periodStart = monthStart(now);
    const clients = await prisma.client.findMany({ where: { isActive: true, reportEmailEnabled: true, monthlyReportEmailEnabled: true, OR: [{ lastMonthlyReportAt: null }, { lastMonthlyReportAt: { lt: periodStart } }] } });
    let reports = 0;
    let emailed = 0;
    for (const client of clients) {
      if (!hasAccess(client, now)) continue;
      const latest = await prisma.crawlJob.findFirst({
        where: { status: "completed", website: { clientId: client.id, status: "active" } },
        orderBy: { completedAt: "desc" },
        include: { website: { select: { domain: true } } },
      });
      if (!latest) continue;
      const previous = await prisma.crawlJob.findFirst({
        where: { status: "completed", website: { clientId: client.id, status: "active" }, id: { not: latest.id }, completedAt: { lt: latest.completedAt ?? latest.createdAt } },
        orderBy: { completedAt: "desc" },
      });
      const issuesBySeverity = await prisma.issue.groupBy({ by: ["severity"], where: { crawlJobId: latest.id }, _count: true });
      const summary = {
        generatedAt: now.toISOString(),
        latestCrawlId: latest.id,
        domain: latest.website.domain,
        score: latest.siteScore,
        previousScore: previous?.siteScore ?? null,
        scoreChange: latest.siteScore != null && previous?.siteScore != null ? latest.siteScore - previous.siteScore : null,
        pagesCrawled: latest.pagesCrawled,
        errorCount: latest.errorCount,
        issuesBySeverity: issuesBySeverity.map((item) => ({ severity: item.severity, count: item._count })),
        recommendations: [
          "Review high severity technical issues first.",
          "Use keyword and AI-search reports to prioritize content updates.",
          "Re-run the crawl after fixes to measure score movement.",
        ],
      };
      const report = await prisma.monthlyClientReport.upsert({
        where: { clientId_periodStart: { clientId: client.id, periodStart } },
        create: { clientId: client.id, periodStart, summaryJson: summary },
        update: { summaryJson: summary, status: "ready" },
      });
      reports += 1;
      const sent = await notifyClient({
        clientId: client.id,
        fallbackEmail: client.contactEmail,
        subject: `Your SEnuke AI monthly report is ready`,
        text: `Your monthly report for ${latest.website.domain} is ready. Score: ${latest.siteScore ?? "not scored"}. Open SEnuke AI: ${appLink("/")}`,
        html: `<p>Your monthly report for <strong>${latest.website.domain}</strong> is ready.</p><p>Score: <strong>${latest.siteScore ?? "not scored"}</strong></p><p><a href="${appLink("/")}">Open SEnuke AI</a></p>`,
      });
      if (sent) {
        await prisma.monthlyClientReport.update({ where: { id: report.id }, data: { emailSentAt: now } });
        emailed += 1;
      }
      await prisma.client.update({ where: { id: client.id }, data: { lastMonthlyReportAt: now } });
    }
    return { periodStart: periodStart.toISOString(), clientsChecked: clients.length, reports, emailed };
  });
}

export async function taskDeadlineNotifications() {
  return runLogged("task_deadline_notifications", async () => {
    const now = new Date();
    const approachingCutoff = new Date(now.getTime() + DAY_MS);
    const tasks = await prisma.executionTask.findMany({
      where: {
        dueAt: { lte: approachingCutoff },
        status: { notIn: ["completed", "skipped", "published", "cancelled", "canceled"] },
        project: { agencyClient: { isNot: null } },
        OR: [
          { dueAt: { gt: now }, deadlineApproachingNotifiedAt: null },
          { dueAt: { lte: now }, deadlineOverdueNotifiedAt: null },
        ],
      },
      include: {
        assignee: { include: { user: { select: { id: true, name: true, email: true } }, roles: true } },
        manager: { include: { user: { select: { id: true, name: true, email: true } }, roles: true } },
        project: { include: { agencyClient: { include: { workspace: true } } } },
      },
      take: 500,
    });
    let approaching = 0;
    let overdue = 0;
    let emails = 0;
    for (const task of tasks) {
      const workspace = task.project?.agencyClient?.workspace;
      if (!workspace || !task.dueAt) continue;
      const isOverdue = task.dueAt <= now;
      const settings = workspace.settingsJson && typeof workspace.settingsJson === "object" && !Array.isArray(workspace.settingsJson)
        ? workspace.settingsJson as { emailNotifications?: { deadlineApproaching?: boolean; deadlineOverdue?: boolean } }
        : {};
      const emailEnabled = isOverdue
        ? settings.emailNotifications?.deadlineOverdue !== false
        : settings.emailNotifications?.deadlineApproaching !== false;
      const memberships = [task.assignee, task.manager].filter((membership): membership is NonNullable<typeof task.assignee> => Boolean(membership));
      const recipients = [...new Map(memberships
        .filter((membership) => !membership.roles.some((role) => role.role === "client_viewer"))
        .map((membership) => [membership.user.id, membership.user])).values()];
      const title = isOverdue ? "Task deadline overdue" : "Task deadline approaching";
      const body = isOverdue
        ? `${task.title} was due ${task.dueAt.toLocaleDateString()}.`
        : `${task.title} is due ${task.dueAt.toLocaleString()}.`;
      for (const recipient of recipients) {
        const notification = await prisma.workspaceNotification.create({
          data: {
            workspaceId: workspace.id, userId: recipient.id, agencyClientId: task.project!.agencyClientId,
            projectId: task.projectId, type: isOverdue ? "deadline_overdue" : "deadline_approaching",
            title, body, actionUrl: `/guided-projects/${task.projectId}#execution-tasks`,
            emailEligible: emailEnabled, emailStatus: emailEnabled ? "pending" : "disabled",
          },
        });
        if (emailEnabled) {
          try {
            await sendMail({
              to: recipient.email, subject: `${title}: ${task.title}`,
              text: `${body} Open the project: ${appLink(`/guided-projects/${task.projectId}#execution-tasks`)}`,
              html: `<p>${body}</p><p><a href="${appLink(`/guided-projects/${task.projectId}#execution-tasks`)}">Open project task</a></p>`,
            });
            await prisma.workspaceNotification.update({ where: { id: notification.id }, data: { emailStatus: "sent" } });
            emails += 1;
          } catch (error) {
            await prisma.workspaceNotification.update({ where: { id: notification.id }, data: { emailStatus: "failed" } });
            console.error("[maintenance] deadline email failed", error);
          }
        }
      }
      await prisma.executionTask.update({
        where: { id: task.id },
        data: isOverdue ? { deadlineOverdueNotifiedAt: now } : { deadlineApproachingNotifiedAt: now },
      });
      if (isOverdue) overdue += 1;
      else approaching += 1;
    }
    return { checked: tasks.length, approaching, overdue, emails };
  });
}

export async function approvalReminderEscalations(now = new Date()) {
  return runLogged("approval_reminder_escalations", async () => {
    const tasks = await prisma.executionTask.findMany({
      where: { status: "submitted_for_approval", submittedAt: { not: null, lte: new Date(now.getTime() - DAY_MS) } },
      include: {
        manager: { include: { user: { select: { id: true } } } },
        project: { include: { agencyClient: { include: { workspace: { include: { memberships: { where: { status: "active" }, include: { roles: true } } } } } }, client: { include: { workspace: { include: { memberships: { where: { status: "active" }, include: { roles: true } } } } } } } },
      },
      take: 500,
    });
    let managerReminders = 0;
    let ownerEscalations = 0;
    for (const task of tasks) {
      if (!task.submittedAt || !task.projectId) continue;
      const workspace = task.project?.agencyClient?.workspace ?? task.project?.client.workspace;
      if (!workspace) continue;
      const stage = approvalEscalationStage(task.submittedAt, now);
      if (!stage) continue;
      const type = stage === "owner" ? "approval_escalated_owner" : "approval_reminder_manager";
      const actionUrl = `/approvals?projectId=${task.projectId}&taskId=${task.id}`;
      const alreadySent = await prisma.workspaceNotification.findFirst({ where: { workspaceId: workspace.id, type, actionUrl }, select: { id: true } });
      if (alreadySent) continue;
      const managerIds = task.manager?.userId ? [task.manager.userId] : workspace.memberships.filter((membership) => membership.roles.some((role) => ["manager", "approver", "manager_approver"].includes(role.role))).map((membership) => membership.userId);
      const recipients = stage === "owner" ? [workspace.ownerUserId] : managerIds.length ? managerIds : [workspace.ownerUserId];
      for (const userId of [...new Set(recipients)]) await prisma.workspaceNotification.create({ data: {
        workspaceId: workspace.id, userId, agencyClientId: task.project.agencyClientId, projectId: task.projectId, type,
        title: stage === "owner" ? "Approval escalated to Owner" : "Approval reminder",
        body: `${task.title} has been waiting for approval since ${task.submittedAt.toLocaleString()}.`, actionUrl,
        emailEligible: true, emailStatus: "pending",
      } });
      if (stage === "owner") ownerEscalations += 1;
      else managerReminders += 1;
    }
    return { checked: tasks.length, managerReminders, ownerEscalations };
  });
}

export async function workspaceNotificationEmailDelivery(now = new Date()) {
  return runLogged("workspace_notification_email_delivery", async () => {
    const notifications = await prisma.workspaceNotification.findMany({
      where: { emailEligible: true, emailStatus: "pending" }, orderBy: { createdAt: "asc" }, take: 500,
      include: { user: { select: { email: true, workspaceMemberships: { where: { status: "active" }, select: { workspaceId: true, permissionOverrides: true } } } } },
    });
    const groups = new Map<string, typeof notifications>();
    for (const notification of notifications) groups.set(notification.userId, [...(groups.get(notification.userId) ?? []), notification]);
    let sent = 0; let deferred = 0; let failed = 0;
    for (const items of groups.values()) {
      const recipient = items[0].user;
      const membership = recipient.workspaceMemberships.find((item) => item.workspaceId === items[0].workspaceId);
      const overrides = membership?.permissionOverrides && typeof membership.permissionOverrides === "object" && !Array.isArray(membership.permissionOverrides) ? membership.permissionOverrides as { notificationPreferences?: unknown } : {};
      const preferences = overrides.notificationPreferences && typeof overrides.notificationPreferences === "object" && !Array.isArray(overrides.notificationPreferences) ? overrides.notificationPreferences as { emailFrequency?: unknown } : {};
      const frequency = ["immediate", "daily", "weekly", "monthly"].includes(String(preferences.emailFrequency)) ? String(preferences.emailFrequency) : "daily";
      const critical = items.filter((item) => /security|integration.*(failed|disconnected)|publishing_failed|critical/.test(item.type));
      const routine = items.filter((item) => !critical.includes(item));
      const batches: (typeof notifications)[] = critical.map((item) => [item]);
      const ageRequired = frequency === "daily" ? DAY_MS : frequency === "weekly" ? 7 * DAY_MS : frequency === "monthly" ? 30 * DAY_MS : 0;
      const readyRoutine = routine.filter((item) => now.getTime() - item.createdAt.getTime() >= ageRequired);
      if (readyRoutine.length) batches.push(readyRoutine);
      deferred += routine.length - readyRoutine.length;
      for (const batch of batches) {
        const lines = batch.map((item) => `${item.title}: ${item.body}`);
        try {
          await sendMail({ to: recipient.email, subject: batch.length > 1 ? `${batch.length} SEnuke AI project updates` : batch[0].title, text: lines.join("\n\n"), html: `<p>${lines.map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("</p><p>")}</p><p><a href="${appLink(batch[0].actionUrl || "/")}">Open SEnuke AI</a></p>` });
          await prisma.workspaceNotification.updateMany({ where: { id: { in: batch.map((item) => item.id) } }, data: { emailStatus: "sent" } });
          sent += batch.length;
        } catch (error) {
          await prisma.workspaceNotification.updateMany({ where: { id: { in: batch.map((item) => item.id) } }, data: { emailStatus: "failed" } });
          failed += batch.length;
          console.error("[maintenance] workspace notification email failed", error);
        }
      }
    }
    return { checked: notifications.length, sent, deferred, failed };
  });
}

export async function measurementCheckpointNotifications(now = new Date()) {
  return runLogged("measurement_checkpoint_notifications", async () => {
    const checkpoints = await prisma.measurementCheckpoint.findMany({ where: { status: "scheduled", dueAt: { lte: now } }, take: 500, include: { project: { include: { agencyClient: { include: { workspace: true } }, client: { include: { workspace: true } } } }, task: { select: { title: true } } } });
    let notified = 0;
    for (const checkpoint of checkpoints) {
      const workspace = checkpoint.project.agencyClient?.workspace ?? checkpoint.project.client.workspace;
      if (!workspace) continue;
      const actionUrl = `/guided-projects/${checkpoint.projectId}?tab=execution#optimization-workflow`;
      const exists = await prisma.workspaceNotification.findFirst({ where: { workspaceId: workspace.id, type: "measurement_checkpoint_due", actionUrl, body: { contains: checkpoint.id } }, select: { id: true } });
      if (exists) continue;
      await prisma.workspaceNotification.create({ data: { workspaceId: workspace.id, userId: workspace.ownerUserId, agencyClientId: checkpoint.project.agencyClientId, projectId: checkpoint.projectId, type: "measurement_checkpoint_due", title: `${checkpoint.checkpointType.replaceAll("_", " ")} review due`, body: `${checkpoint.task.title} is ready for its measurement review. Checkpoint ${checkpoint.id}.`, actionUrl, emailEligible: true, emailStatus: "pending" } });
      await prisma.measurementCheckpoint.update({ where: { id: checkpoint.id }, data: { status: "due" } });
      notified += 1;
    }
    return { checked: checkpoints.length, notified };
  });
}

export async function scheduledGrowthBlueprintReviews(now = new Date()) {
  return runLogged("scheduled_growth_blueprint_reviews", async () => {
    const blueprints = await prisma.growthBlueprint.findMany({
      where: { status: "active", nextReviewAt: { lte: now } },
      take: 500,
      include: {
        project: {
          include: {
            agencyClient: { include: { workspace: true } },
            client: { include: { workspace: true } },
          },
        },
      },
    });
    let notified = 0;
    for (const blueprint of blueprints) {
      const workspace = blueprint.project.agencyClient?.workspace ?? blueprint.project.client.workspace;
      const actionUrl = `/growth?projectId=${blueprint.projectId}&tab=recommendations`;
      if (workspace) {
        const existing = await prisma.workspaceNotification.findFirst({
          where: {
            workspaceId: workspace.id,
            projectId: blueprint.projectId,
            type: "growth_review_due",
            actionUrl,
            createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
          },
          select: { id: true },
        });
        if (!existing) {
          await prisma.workspaceNotification.create({
            data: {
              workspaceId: workspace.id,
              userId: workspace.ownerUserId,
              agencyClientId: blueprint.project.agencyClientId,
              projectId: blueprint.projectId,
              type: "growth_review_due",
              title: "Growth Blueprint review due",
              body: `${blueprint.project.name} is ready for a fresh evidence, diagnosis, and Next Best Action review.`,
              actionUrl,
              emailEligible: true,
              emailStatus: "pending",
            },
          });
          notified += 1;
        }
      }
      await prisma.growthBlueprint.update({
        where: { id: blueprint.id },
        data: { nextReviewAt: new Date(now.getTime() + 7 * DAY_MS) },
      });
    }
    return { checked: blueprints.length, notified };
  });
}

export async function pendingContentDiscoveryChecks(now = new Date()) {
  return runLogged("pending_content_discovery_checks", async () => {
    const checks = await prisma.contentDiscoveryCheck.findMany({ where: { status: "pending" }, take: 100, include: { project: { include: { agencyClient: { include: { workspace: true } }, client: { include: { workspace: true } } } }, task: true } });
    let verified = 0; let issues = 0;
    for (const check of checks) {
      let data: { status: string; httpStatus?: number; canonicalUrl?: string; canonicalMatches?: boolean; indexable?: boolean; robotsAllowed?: boolean; sitemapPresent?: boolean; analyticsDetected?: boolean; evidenceJson: Prisma.InputJsonValue; errorMessage?: string; checkedAt: Date; firstDiscoveredAt?: Date };
      try {
        const url = await safeDiscoveryUrl(check.liveUrl);
        const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "SEnukeAI-DiscoveryCheck/1.0" } });
        const html = (await response.text()).slice(0, 2_000_000);
        const canonicalRaw = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)/i)?.[1] ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical/i)?.[1];
        const canonicalUrl = canonicalRaw ? new URL(canonicalRaw, url).toString() : response.url;
        const normalized = (value: string) => value.replace(/\/$/, "").toLowerCase();
        const robotsMeta = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i)?.[1]?.toLowerCase() ?? "";
        const indexable = response.ok && !robotsMeta.includes("noindex") && response.headers.get("x-robots-tag")?.toLowerCase().includes("noindex") !== true;
        const sitemapUrl = new URL("/sitemap.xml", url.origin);
        const sitemapResponse = await fetch(sitemapUrl, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "SEnukeAI-DiscoveryCheck/1.0" } });
        const sitemapText = sitemapResponse.ok ? (await sitemapResponse.text()).slice(0, 5_000_000) : "";
        const canonicalMatches = normalized(canonicalUrl) === normalized(check.liveUrl) || normalized(canonicalUrl) === normalized(response.url);
        const sitemapPresent = sitemapResponse.ok && [check.liveUrl, response.url, canonicalUrl].some((candidate) => sitemapText.includes(candidate.replace(/&/g, "&amp;")) || sitemapText.includes(candidate));
        const analyticsDetected = /googletagmanager|google-analytics|gtag\(|plausible\.io|matomo/i.test(html);
        const healthy = response.ok && canonicalMatches && indexable && sitemapPresent;
        data = { status: healthy ? "verified" : "issue", httpStatus: response.status, canonicalUrl, canonicalMatches, indexable, robotsAllowed: indexable, sitemapPresent, analyticsDetected, evidenceJson: { finalUrl: response.url, robotsMeta, sitemapUrl: sitemapUrl.toString() }, checkedAt: now, ...(healthy ? { firstDiscoveredAt: now } : { errorMessage: "Live URL failed availability, canonical, indexability, or sitemap verification." }) };
      } catch (error) { data = { status: "issue", evidenceJson: {}, errorMessage: error instanceof Error ? error.message : "Discovery verification failed.", checkedAt: now }; }
      await prisma.$transaction(async (tx) => {
        await tx.contentDiscoveryCheck.update({ where: { id: check.id }, data });
        const snapshot = check.task.approvalSnapshotJson && typeof check.task.approvalSnapshotJson === "object" && !Array.isArray(check.task.approvalSnapshotJson) ? check.task.approvalSnapshotJson as Record<string, unknown> : {};
        await tx.executionTask.update({ where: { id: check.taskId }, data: { status: data.status === "verified" ? "published" : "discovery_issue", blockedReason: data.status === "verified" ? null : data.errorMessage, approvalSnapshotJson: { ...snapshot, latestDiscoveryCheckId: check.id, contentWorkflow: { ...((snapshot.contentWorkflow as object) ?? {}), currentStage: data.status === "verified" ? "performance_monitoring" : "discovery_check" } } as Prisma.InputJsonValue } });
        const workspace = check.project.agencyClient?.workspace ?? check.project.client.workspace;
        if (workspace && data.status !== "verified") await tx.workspaceNotification.create({ data: { workspaceId: workspace.id, userId: workspace.ownerUserId, agencyClientId: check.project.agencyClientId, projectId: check.projectId, type: "content_discovery_issue", title: "Discovery issue detected", body: `${check.task.title}: ${data.errorMessage}`, actionUrl: `/guided-projects/${check.projectId}?tab=execution#optimization-workflow`, emailEligible: true, emailStatus: "pending" } });
      });
      if (data.status === "verified") verified += 1; else issues += 1;
    }
    return { checked: checks.length, verified, issues };
  });
}

export async function scheduledLocalGridScans(now = new Date()) {
  return runLogged("scheduled_local_grid_scans", async () => {
    const configs = await prisma.localGridConfiguration.findMany({ where: { active: true, schedule: { not: "manual" } }, include: { scans: { orderBy: { scanDate: "desc" }, take: 1 }, keyword: { include: { business: true } } } });
    let queued = 0;
    for (const item of configs) {
      const days = item.schedule === "weekly" ? 7 : item.schedule === "biweekly" ? 14 : 30;
      const latest = item.scans[0];
      if (latest && now.getTime() - latest.scanDate.getTime() < days * DAY_MS) continue;
      const half = (item.gridSize - 1) / 2;
      const latStep = item.radiusKm / 111 / Math.max(1, half);
      const lonStep = item.radiusKm / (111 * Math.max(.2, Math.cos(item.centerLatitude * Math.PI / 180))) / Math.max(1, half);
      const requestedPoints = Array.from({ length: item.gridSize ** 2 }, (_, index) => { const rowIndex = Math.floor(index / item.gridSize); const columnIndex = index % item.gridSize; return { rowIndex, columnIndex, latitude: item.centerLatitude + (half - rowIndex) * latStep, longitude: item.centerLongitude + (columnIndex - half) * lonStep }; });
      await prisma.localGridScan.create({ data: { configurationId: item.id, status: "queued", scanDate: now, summaryJson: { requestedPoints, scheduled: true, keyword: item.keyword.keyword, city: item.keyword.city, engine: item.engine, resultDepth: item.resultDepth } } });
      queued += 1;
    }
    return { checked: configs.length, queued };
  });
}

export async function scheduledProjectReportGeneration(now = new Date()) {
  void now;
  return { generated: 0, delivered: 0, disabled: true as const };
  /* Legacy scheduler retained as migration reference only. DEV-049 V1 reports are on demand.
  return runLogged("scheduled_project_report_generation", async () => {
    const workspaces = await prisma.workspace.findMany({ where: { status: "active" }, select: { id: true, legacyClientId: true, name: true, workspaceType: true, ownerUserId: true, settingsJson: true } });
    let generated = 0; let delivered = 0;
    for (const workspace of workspaces) {
      const settings = workspace.settingsJson && typeof workspace.settingsJson === "object" && !Array.isArray(workspace.settingsJson) ? workspace.settingsJson as { reportSchedules?: unknown } : {};
      const schedules = Array.isArray(settings.reportSchedules) ? settings.reportSchedules : [];
      for (const raw of schedules) {
        if (!raw || typeof raw !== "object") continue;
        const schedule = raw as { projectId?: unknown; reportType?: unknown; frequency?: unknown; automaticClientDelivery?: unknown };
        if (typeof schedule.projectId !== "string" || typeof schedule.reportType !== "string" || !projectReportTypes.includes(schedule.reportType as typeof projectReportTypes[number]) || schedule.reportType === "agency_proposal" || !["weekly", "monthly", "milestone"].includes(String(schedule.frequency))) continue;
        const project = await prisma.project.findFirst({ where: { id: schedule.projectId, ...(workspace.workspaceType === "agency" ? { agencyClient: { workspaceId: workspace.id } } : workspace.legacyClientId ? { clientId: workspace.legacyClientId } : { id: "__not_found__" }) }, include: { agencyClient: { select: { id: true, name: true, memberAssignments: { include: { membership: { include: { user: { select: { id: true } }, roles: true } } } } } }, website: { select: { domain: true, crawlJobs: { where: { status: "completed" }, orderBy: { completedAt: "desc" }, take: 1, select: { siteScore: true, pagesCrawled: true, completedAt: true } } } }, strategyPlans: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, status: true, strategySummary: true, updatedAt: true } }, businessBrainVersions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, createdAt: true } }, evidenceVersions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, freshness: true, createdAt: true } }, growthBlueprint: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } }, nextBestActions: { where: { status: { in: ["proposed", "selected", "approved", "in_progress"] } }, orderBy: [{ selectedAt: "desc" }, { priorityScore: "desc" }], take: 3 }, growthExperiments: { include: { results: { orderBy: { recordedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: 20 }, executionTasks: { select: { title: true, status: true, completedAt: true, publishedAt: true, approvedAt: true } } } });
        if (!project) continue;
        const latest = await prisma.gapReportExport.findFirst({ where: { projectId: project.id, reportType: schedule.reportType }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
        const interval = schedule.frequency === "weekly" ? 7 * DAY_MS : schedule.frequency === "monthly" ? 30 * DAY_MS : 0;
        const due = !latest || (schedule.frequency === "milestone" ? project.updatedAt > latest.createdAt : now.getTime() - latest.createdAt.getTime() >= interval);
        if (!due) continue;
        const periodStart = schedule.frequency === "weekly" ? new Date(now.getTime() - 7 * DAY_MS) : schedule.frequency === "monthly" ? monthStart(now) : latest?.createdAt ?? project.createdAt;
        const periodEnd = now;
        // V1 keeps every scheduled Agency document behind human review. Fully
        // automatic branded delivery and delivery analytics are intentionally V2.
        const automatic = false;
        const completed = project.executionTasks.filter((task) => task.completedAt && task.completedAt >= periodStart && task.completedAt <= periodEnd);
        const published = project.executionTasks.filter((task) => task.publishedAt && task.publishedAt >= periodStart && task.publishedAt <= periodEnd);
        const awaitingApproval = project.executionTasks.filter((task) => !task.approvedAt && /approval/.test(task.status));
        const branding = await prisma.whiteLabelProfile.findFirst({ where: { OR: [{ workspaceId: workspace.id }, { clientId: workspace.legacyClientId ?? "__none__", projectId: null }] }, orderBy: { updatedAt: "desc" } });
        const definition = projectReportCatalog.find((item) => item.type === schedule.reportType)!;
        const sourceSnapshot = { capturedAt: now.toISOString(), reportingPeriod: { start: periodStart.toISOString(), end: periodEnd.toISOString() }, businessBrain: project.businessBrainVersions[0] ?? null, evidence: project.evidenceVersions[0] ?? null, strategy: project.strategyPlans[0] ?? null, growthBlueprint: project.growthBlueprint ? { id: project.growthBlueprint.id, version: project.growthBlueprint.versions[0]?.version ?? project.growthBlueprint.currentVersion, status: project.growthBlueprint.status, updatedAt: project.growthBlueprint.updatedAt } : null, nextBestAction: project.nextBestActions[0] ?? null, siteAnalysis: project.website?.crawlJobs[0] ?? null };
        const reportBranding = { agencyName: branding?.agencyName ?? workspace.name, agencyLogoFileId: branding?.agencyLogoFileId ?? null, agencyLogoDataUrl: branding?.agencyLogoDataUrl ?? null, preparedByName: branding?.preparedByName ?? null, contactEmail: branding?.contactEmail ?? null, contactPhone: branding?.contactPhone ?? null, websiteUrl: branding?.websiteUrl ?? null, address: branding?.address ?? null, colorPreference: branding?.colorPreference ?? "#0F9F8F", secondaryColor: branding?.secondaryColor ?? "#0F172A", footerDisclaimer: branding?.footerDisclaimer ?? "Confidential — prepared for the named client only.", senderSignature: branding?.senderSignature ?? null, minimizeSenukeBranding: branding?.minimizeSenukeBranding ?? true };
        const sections = definition.sections.map((title, index) => ({ key: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), title, order: index, enabled: true }));
        const content = { title: `${project.name} ${definition.title}`, reportType: schedule.reportType, generatedAt: now.toISOString(), frequency: String(schedule.frequency), reportingPeriod: sourceSnapshot.reportingPeriod, sourceSnapshot, branding: reportBranding, project: { id: project.id, name: project.name, businessName: project.businessName, website: project.website?.domain, primaryGoal: project.primaryGoal, targetMarkets: project.targetLocations }, health: { workflowStep: project.currentStep, strategyStatus: project.strategyPlans[0]?.status ?? "not_started", completedTasks: completed.length, totalTasks: project.executionTasks.length, blockedTasks: project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status)).length }, execution: { completed: completed.map((task) => ({ title: task.title })), published: published.map((task) => task.title), awaitingApproval: awaitingApproval.map((task) => task.title), blocked: project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status)).map((task) => task.title), scheduledNext: [] }, strategy: project.strategyPlans[0] ? { version: project.strategyPlans[0].version, status: project.strategyPlans[0].status, summary: project.strategyPlans[0].strategySummary } : null, growth: { blueprint: project.growthBlueprint ? { id: project.growthBlueprint.id, title: project.growthBlueprint.title, status: project.growthBlueprint.status, currentVersion: project.growthBlueprint.versions[0]?.version ?? project.growthBlueprint.currentVersion, currentPhase: project.growthBlueprint.currentPhase, goals: project.growthBlueprint.versions[0]?.goalsJson ?? [] } : null, nextBestActions: project.nextBestActions.map((action) => ({ id: action.id, title: action.title, recommendation: action.recommendation, expectedImpact: action.expectedImpact, status: action.status })), experiments: project.growthExperiments.filter((experiment) => experiment.updatedAt >= periodStart).map((experiment) => ({ title: experiment.title, status: experiment.status, metric: experiment.metric, result: experiment.results[0] ?? null })) }, clientNarrative: { executiveNarrative: `${project.name} recorded ${completed.length} completed action${completed.length === 1 ? "" : "s"} during this reporting period. The report uses the saved evidence snapshot below and keeps unavailable performance data separate from measured results.`, wins: completed.slice(0, 5).map((task) => task.title), risks: project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status)).slice(0, 5).map((task) => task.title), interpretation: "Review the measured evidence, completed work, and current Next Best Actions together before deciding the next priority." }, sections, recommendations: project.nextBestActions.map((action) => action.recommendation), clientSafe: true };
        const qa = { status: "passed", checkedAt: now.toISOString(), checks: [{ key: "identity", status: "passed", message: "Agency and project identity are present." }, { key: "period", status: "passed", message: "The reporting period is recorded." }, { key: "sources", status: "passed", message: "Source identifiers and timestamps are retained." }, { key: "missing_data", status: "passed", message: "Unavailable data is not represented as measured zero performance." }] };
        const report = await prisma.gapReportExport.create({ data: { workspaceId: workspace.id, agencyClientId: project.agencyClientId, projectId: project.id, clientId: project.clientId, reportType: schedule.reportType, clientName: project.agencyClient?.name ?? project.businessName ?? project.name, approvalStatus: automatic ? "approved" : workspace.workspaceType === "agency" ? "needs_review" : "approved", documentStatus: automatic ? "sent" : "draft", exportFormat: "secure_link", status: "ready", completedAt: now, periodStart, periodEnd, qaStatus: qa.status, qaJson: qa, createdByUserId: workspace.ownerUserId, clientVisible: automatic, sentToClientAt: automatic ? now : null, sentByUserId: automatic ? workspace.ownerUserId : null, contentJson: content, versions: { create: { version: 1, contentJson: content, sourceEvidenceJson: sourceSnapshot, sourceTimestampsJson: sourceSnapshot, strategyVersion: project.strategyPlans[0]?.version, growthBlueprintVersion: project.growthBlueprint?.versions[0]?.version ?? project.growthBlueprint?.currentVersion, nextBestActionId: project.nextBestActions[0]?.id, createdByUserId: workspace.ownerUserId, sections: { create: sections.map((section) => ({ sectionType: section.key, sortOrder: section.order, enabled: true, contentJson: { title: section.title } })) } } } } });
        await prisma.workspaceActivity.create({ data: { workspaceId: workspace.id, actorUserId: workspace.ownerUserId, agencyClientId: project.agencyClientId, projectId: project.id, action: automatic ? "report.generated_and_sent" : "report.generated", entityType: "gap_report_export", entityId: report.id, nextJson: { reportType: schedule.reportType, periodStart, periodEnd, version: 1, qaStatus: qa.status, automaticDelivery: automatic } } });
        await prisma.workspaceNotification.create({ data: { workspaceId: workspace.id, userId: workspace.ownerUserId, agencyClientId: project.agencyClientId, projectId: project.id, type: "report_ready", title: "Scheduled report ready", body: `${project.name}'s ${String(schedule.reportType).replace(/_/g, " ")} is ready${automatic ? " and was shared automatically" : " for review"}.`, actionUrl: `/reports?projectId=${project.id}`, emailEligible: true, emailStatus: "pending" } });
        if (automatic && project.agencyClient) {
          const clientViewers = project.agencyClient.memberAssignments.filter((assignment) => assignment.membership.roles.length === 1 && assignment.membership.roles[0].role === "client_viewer");
          for (const viewer of clientViewers) await prisma.workspaceNotification.create({ data: { workspaceId: workspace.id, userId: viewer.membership.user.id, agencyClientId: project.agencyClientId, projectId: project.id, type: "report_sent", title: "New client report", body: `${project.name}'s report is ready.`, actionUrl: `/reports?projectId=${project.id}`, emailEligible: true, emailStatus: "pending" } });
          delivered += 1;
        }
        generated += 1;
        void report;
      }
    }
    return { generated, delivered };
  });
  */
}

let running = false;

export async function runMaintenanceSuite() {
  if (running) return;
  running = true;
  try {
    await recoverQueuedCrawlJobs();
    await commercialLifecycleSync();
    await dailyBillingAccessSync();
    await monthlyUsageReset();
    await monthlyScheduledAudit();
    await weeklyRankingReportGeneration();
    await monthlyClientReportGeneration();
    await taskDeadlineNotifications();
    await approvalReminderEscalations();
    await pendingContentDiscoveryChecks();
    await measurementCheckpointNotifications();
    await scheduledGrowthBlueprintReviews();
    await scheduledLocalGridScans();
    await workspaceNotificationEmailDelivery();
  } finally {
    running = false;
  }
}

export function startMaintenanceScheduler() {
  const run = () => runMaintenanceSuite().catch((error) => console.error("[maintenance] suite failed", error));
  setTimeout(run, config.maintenanceInitialDelayMs);
  return setInterval(run, config.maintenanceIntervalMs);
}
