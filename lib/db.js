// lib/db.js
// PostgreSQL database helper functions

import { Pool } from 'pg';

let pool = null;

// Singleton pattern for PG Pool
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL || null;
  if (connectionString) {
    pool = new Pool({ connectionString });
  } else {
    // prefer DB_* env vars (as in .env) then fall back to PG* vars
    const host = process.env.DB_HOST ? String(process.env.DB_HOST).trim() : (process.env.PGHOST ? String(process.env.PGHOST).trim() : 'localhost');
    const port = process.env.DB_PORT ? parseInt(String(process.env.DB_PORT).trim(), 10) : (process.env.PGPORT ? parseInt(String(process.env.PGPORT).trim(), 10) : 5432);
    const user = process.env.DB_USERNAME ? String(process.env.DB_USERNAME).trim() : (process.env.PGUSER ? String(process.env.PGUSER).trim() : (process.env.USER || ''));
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : (process.env.PGDATABASE ? String(process.env.PGDATABASE).trim() : (process.env.USER || undefined));
    const rawPwd = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? process.env.DB_PASS ?? process.env.PASSWORD ?? undefined;
    const pwd = rawPwd === undefined || rawPwd === null ? undefined : String(rawPwd);

    const cfg = { host, port, user, database: dbName };
    if (pwd !== undefined && pwd.trim() !== '') cfg.password = pwd;
    pool = new Pool(cfg);
  }
  return pool;
}

// Test and initialize DB connection
async function init() {
  const p = getPool();
  try {
    await p.query('SELECT 1');
    return p;
  } catch (e) {
    const err = new Error(`Postgres connection failed: ${e && e.message ? e.message : String(e)}`);
    err.cause = e;
    throw err;
  }
}

// Generic query function
async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

// Create a new workspace
async function createWorkspace({ name, description = null, owner = null, metadata = {} }) {
  const sql = `INSERT INTO workspaces (name, description, owner, metadata) VALUES ($1,$2,$3,$4) RETURNING *`;
  const res = await query(sql, [name, description, owner, metadata]);
  return res.rows[0];
}

// Get all workspaces
async function getWorkspaces({ name, description = null, owner = null, metadata = {} }) {
  const sql = `SELECT * FROM workspaces ORDER BY id DESC`;
  const res = await query(sql);
  return res.rows;
}

// Create a new rubric
async function createRubric({ workspaceId = null, name, description = null, config = [] }) {
  const sql = `INSERT INTO rubrics (workspace_id, name, description, config) VALUES ($1,$2,$3,$4) RETURNING *`;
  const res = await query(sql, [workspaceId, name, description, config]);
  return res.rows[0];
}

// Create multiple rubric criteria in bulk
async function createRubricCriteriaBulk(rubricId, criteriaArray) {
  // criteriaArray: [{ idx, key, title, description, max_score }, ...]
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const c of criteriaArray) {
      const res = await client.query(
        `INSERT INTO rubric_criteria (rubric_id, idx, key, title, description, weight, max_score) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [rubricId, c.idx || 0, c.key || null, c.title, c.description || null, c.weight ?? 0, c.max_score || 1]
      );
      inserted.push(res.rows[0]);
    }
    await client.query('COMMIT');
    return inserted;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Create a new video record
async function createVideo({ jobExternalId = null, workspaceId = null, rubricId = null, title = null, originalPath = null, presentationPath = null, thumbnailPath = null, status = null, durationSeconds = null, metadata = null }) {
  const sql = `INSERT INTO videos (job_external_id, workspace_id, rubric_id, title, original_path, presentation_path, thumbnail_path, status, duration_seconds, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
  const res = await query(sql, [jobExternalId, workspaceId, rubricId, title, originalPath, presentationPath, thumbnailPath, status, durationSeconds, metadata]);
  return res.rows[0];
}

// Get a video by its job external ID
async function getVideoByJobExternalId(jobExternalId) {
  const sql = `SELECT * FROM videos WHERE job_external_id = $1 LIMIT 1`;
  const res = await query(sql, [jobExternalId]);
  return res.rows[0] || null;
}

// Get all videos for a given workspace ID
async function getVideosByWorkspaceId(workspaceId) {
  const sql = `SELECT * FROM videos WHERE workspace_id = $1 ORDER BY id DESC`;
  const res = await query(sql, [workspaceId]);
  return res.rows;
}

// Get all evaluations for a list of video IDs
async function getEvaluationsByVideoIds(videoIds) {
  if (!Array.isArray(videoIds) || videoIds.length === 0) return [];
  const placeholders = videoIds.map((_, idx) => `$${idx + 1}`).join(',');
  const sql = `SELECT * FROM evaluations WHERE video_id IN (${placeholders}) ORDER BY id DESC`;
  const res = await query(sql, videoIds);
  return res.rows;
}

// Insert a video chunk record
async function insertVideoChunk({ videoId, chunkIndex, filePath, durationSeconds }) {
  const sql = `INSERT INTO video_chunks (video_id, chunk_index, file_path, duration_seconds) VALUES ($1,$2,$3,$4) RETURNING *`;
  const res = await query(sql, [videoId, chunkIndex, filePath, durationSeconds]);
  return res.rows[0];
}

// Insert a transcript segment record
async function insertTranscriptSegment({ videoId, startSeconds, endSeconds, text, source = 'srt' }) {
  const sql = `INSERT INTO transcript_segments (video_id, start_seconds, end_seconds, text, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`;
  const res = await query(sql, [videoId, startSeconds, endSeconds, text, source]);
  return res.rows[0];
}

// Insert a new evaluation record
async function insertEvaluation({ videoId, evaluatorId = null, rubricId = null, scores = {}, totalScore = null, notes = null }) {
  const sql = `INSERT INTO evaluations (video_id, evaluator_id, rubric_id, scores, total_score, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
  const res = await query(sql, [videoId, evaluatorId, rubricId, scores, totalScore, notes]);
  return res.rows[0];
}

// Update an existing evaluation record
async function updateEvaluation(id, updates = {}) {
  // allowed updatable columns
  const allowed = ['evaluator_id', 'rubric_id', 'scores', 'total_score', 'notes'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      sets.push(`${key} = $${idx}`);
      params.push(updates[key]);
      idx += 1;
    }
  }
  if (sets.length === 0) throw new Error('no updatable fields provided');
  params.push(id);
  const sql = `UPDATE evaluations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
  const res = await query(sql, params);
  return res.rows[0] || null;
}

// Get the active rubric and its criteria for a given workspace
async function getActiveRubricByWorkspace(workspaceId) {
  const sql = `
    SELECT 
      r.id AS rubric_id,
      r.name,
      r.description,
      r.config,
      json_agg(
        json_build_object(
          'id', c.id,
          'idx', c.idx,
          'key', c.key,
          'title', c.title,
          'description', c.description,
          'weight', c.weight,
          'max_score', c.max_score
        ) ORDER BY c.idx
      ) AS criteria
    FROM rubrics r
    LEFT JOIN rubric_criteria c ON c.rubric_id = r.id
    WHERE r.workspace_id = $1
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT 1
  `;
  const res = await query(sql, [workspaceId]);
  return res.rows[0] || null;
}

export default {
  init,
  query,
  createWorkspace,
  getWorkspaces,
  createRubric,
  createRubricCriteriaBulk,
  createVideo,
  getVideoByJobExternalId,
  getVideosByWorkspaceId,
  getEvaluationsByVideoIds,
  insertVideoChunk,
  insertTranscriptSegment,
  insertEvaluation,
  updateEvaluation,
  getActiveRubricByWorkspace,
};
