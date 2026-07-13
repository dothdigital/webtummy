import { Prisma, prisma, type Client } from "@webtummy/db";
import { crawlQueue } from "./queue.js";
import { config } from "./config.js";
import { sendMail } from "./email.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAYMENT_BLOCKED = new Set(["past_due", "incomplete", "incomplete_expired", "unpaid", "canceled"]);
const STALE_RUNNING_CRAWL_MS = 2 * 60 * 1000;

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
    const crawls = await prisma.crawlJob.findMany({
      where: {
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, status: true },
    });

    let requeued = 0;
    let markedFailed = 0;
    let alreadyTracked = 0;
    const trackedStates = new Set(["active", "waiting", "delayed", "prioritized", "waiting-children"]);

    for (const crawl of crawls) {
      const existingJob = await crawlQueue.getJob(crawl.id);
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

let running = false;

export async function runMaintenanceSuite() {
  if (running) return;
  running = true;
  try {
    await recoverQueuedCrawlJobs();
    await dailyBillingAccessSync();
    await monthlyUsageReset();
    await monthlyScheduledAudit();
    await weeklyRankingReportGeneration();
    await monthlyClientReportGeneration();
    await taskDeadlineNotifications();
  } finally {
    running = false;
  }
}

export function startMaintenanceScheduler() {
  const run = () => runMaintenanceSuite().catch((error) => console.error("[maintenance] suite failed", error));
  setTimeout(run, config.maintenanceInitialDelayMs);
  return setInterval(run, config.maintenanceIntervalMs);
}
