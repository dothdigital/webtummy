import { one, query } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

export interface SocialScheduleRule {
  platform: string;
  defaultHourLocal: number;
  defaultDays: number[]; // 1=Monday, 7=Sunday
}

const DEFAULT_SCHEDULE_RULES: SocialScheduleRule[] = [
  { platform: 'linkedin', defaultHourLocal: 9, defaultDays: [2, 3, 4] },
  { platform: 'facebook', defaultHourLocal: 13, defaultDays: [2, 3, 4, 5] },
  { platform: 'x', defaultHourLocal: 10, defaultDays: [1, 2, 3, 4, 5] },
  { platform: 'instagram', defaultHourLocal: 11, defaultDays: [2, 3, 4] },
  { platform: 'youtube', defaultHourLocal: 15, defaultDays: [4, 5, 6] }
];

/**
 * Phase 8: Social Media Engine.
 * Generates optimized posts, schedules them, and monitors mentions/comments through connected providers.
 */
export class SocialMediaService {
  static async generatePosts(projectId: string, platforms: string[], topic: string) {
    const ai = new AIService();
    const output = await ai.generateAndLog<{ posts: Array<{ platform: string; text: string; hashtags?: string[] }> }>(projectId, {
      moduleName: 'Social Media Engine',
      promptVersion: 'social-posts-v1',
      system: 'Return JSON social posts by platform. Keep content platform-appropriate and avoid unsupported claims.',
      user: JSON.stringify({ platforms, topic }, null, 2),
      jsonSchemaHint: { posts: [] }
    });

    const saved = [];
    for (const post of output.posts ?? []) {
      saved.push(await one<any>(
        `INSERT INTO social_posts(project_id, platform, post_text, post_json, status)
         VALUES($1,$2,$3,$4,'draft') RETURNING *`,
        [projectId, post.platform, post.text, JSON.stringify(post)]
      ));
    }

    await ExecutionService.createTasksFromRecommendations(projectId, 'Social Media Engine', [
      { title: 'Review generated social posts', description: 'Approve or edit generated posts before scheduling.', action: 'Review Posts', automationLevel: 'manual_guided' },
      { title: 'Schedule approved posts', description: 'Schedule posts for recommended times by channel.', action: 'Schedule Posts', automationLevel: 'execute_with_approval' },
      { title: 'Review social mentions', description: 'Monitor comments, mentions, and replies from connected accounts.', action: 'Review Mentions', automationLevel: 'execute_through_integration' }
    ]);

    return saved;
  }

  static async scheduleApprovedPosts(projectId: string, timezone = 'America/Moncton') {
    const drafts = await query<any>('SELECT * FROM social_posts WHERE project_id=$1 AND status=$2', [projectId, 'draft']);
    const scheduled = [];
    for (const post of drafts) {
      const when = this.nextRecommendedSlot(post.platform, timezone);
      scheduled.push(await one<any>('UPDATE social_posts SET scheduled_at=$2, status=$3, updated_at=now() WHERE id=$1 RETURNING *', [post.id, when.toISOString(), 'scheduled']));
    }
    return scheduled;
  }

  static async monitorMentions(projectId: string) {
    // Replace with social provider APIs after permissions are approved.
    const mockMention = await one<any>(
      `INSERT INTO social_mentions(project_id, platform, external_id, author_name, mention_text, sentiment, status, suggested_reply)
       VALUES($1,'linkedin',$2,'Mock User','Can you share more details?','neutral','new','Thanks for asking. Here are the key details...') RETURNING *`,
      [projectId, `mock-${Date.now()}`]
    );
    return [mockMention];
  }

  private static nextRecommendedSlot(platform: string, timezone: string): Date {
    // Reference logic only. Production should use user's actual timezone and analytics/history if available.
    const rule = DEFAULT_SCHEDULE_RULES.find(r => r.platform === platform) ?? DEFAULT_SCHEDULE_RULES[0];
    const now = new Date();
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(rule.defaultHourLocal, 0, 0, 0);
    return candidate;
  }
}
