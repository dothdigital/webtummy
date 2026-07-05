import pg from 'pg';
import { env } from '../modules/core/env.js';

/**
 * Shared PostgreSQL connection pool.
 * Replace direct SQL with a repository/ORM layer if the existing app already uses one.
 */
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
