import { one, query } from '../../db/db.js';
import { getIntakeQuestions } from './intakeQuestions.js';
import type { ProjectType } from './types.js';

/**
 * IntakeService saves raw intake answers and creates a normalized business profile.
 * The normalized profile becomes the stable context used by all AI modules.
 */
export class IntakeService {
  static getQuestions(projectType: ProjectType) {
    return getIntakeQuestions(projectType);
  }

  static async saveAnswers(projectId: string, answers: Record<string, unknown>) {
    const project = await one<any>('SELECT project_type FROM projects WHERE id = $1', [projectId]);
    if (!project) throw new Error('Project not found');

    const questions = getIntakeQuestions(project.project_type as ProjectType);
    for (const q of questions) {
      if (answers[q.key] === undefined) continue;
      await query(
        `INSERT INTO project_intake_answers (project_id, question_key, question_text, answer_value, answer_type)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, question_key)
         DO UPDATE SET answer_value = EXCLUDED.answer_value, answer_type = EXCLUDED.answer_type`,
        [projectId, q.key, q.label, JSON.stringify(answers[q.key]), q.type]
      );
    }

    return this.normalizeBusinessProfile(projectId);
  }

  static async normalizeBusinessProfile(projectId: string) {
    const rows = await query<any>('SELECT question_key, answer_value FROM project_intake_answers WHERE project_id = $1', [projectId]);
    const a = Object.fromEntries(rows.map((r) => [r.question_key, r.answer_value]));

    // This is deterministic normalization. Later phases can enhance it with AI normalization if needed.
    const profile = await one<any>(
      `INSERT INTO business_profiles
       (project_id, business_summary, target_audience, offer_summary, business_model, constraints, budget_level, skill_level, tone_preference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(project_id) DO UPDATE SET
         business_summary = EXCLUDED.business_summary,
         target_audience = EXCLUDED.target_audience,
         offer_summary = EXCLUDED.offer_summary,
         business_model = EXCLUDED.business_model,
         constraints = EXCLUDED.constraints,
         budget_level = EXCLUDED.budget_level,
         skill_level = EXCLUDED.skill_level,
         updated_at = now()
       RETURNING *`,
      [
        projectId,
        `Project in ${a.niche ?? 'unknown niche'} with goal: ${a.primary_goal ?? 'not provided'}`,
        String(a.target_audience ?? 'To be identified by strategy engine'),
        String(a.current_offer ?? a.product_type ?? 'To be defined'),
        String(a.business_model_preference ?? a.platform_preference ?? 'not_sure'),
        JSON.stringify([`Budget: ${a.budget_level ?? 'unknown'}`, `Skill: ${a.skill_level ?? 'unknown'}`]),
        String(a.budget_level ?? 'unknown'),
        String(a.skill_level ?? 'unknown'),
        String(a.tone_preference ?? 'clear_practical')
      ]
    );

    return profile;
  }
}
