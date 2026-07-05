import { query } from '../../db/db.js';

/**
 * Admin utilities for monitoring cost, errors, and user behavior.
 */
export class AdminService {
  static async usageSummary() {
    const aiRuns = await query('SELECT module_name, status, count(*)::int AS total FROM ai_runs GROUP BY module_name, status ORDER BY module_name');
    const projects = await query('SELECT project_type, count(*)::int AS total FROM projects GROUP BY project_type');
    const failedJobs = await query("SELECT * FROM ai_runs WHERE status='failed' ORDER BY created_at DESC LIMIT 25");
    return { aiRuns, projects, failedJobs };
  }
}
