-- 001_create_tables.sql
-- Migrations: create core tables for workspaces, rubrics, videos, chunks, transcripts, evaluations and users
-- Run with: psql -h <host> -U <user> -d <db> -f migrations/001_create_tables.sql

-- Enable uuid generation (pgcrypto) if available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Users (optional)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  role TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Rubrics
CREATE TABLE IF NOT EXISTS rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  config JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Rubric criteria
CREATE TABLE IF NOT EXISTS rubric_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id UUID NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL DEFAULT 0,
  key TEXT,
  title TEXT NOT NULL,
  description TEXT,
  max_score NUMERIC DEFAULT 1,
  weight NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Videos / jobs
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_external_id TEXT,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  rubric_id UUID REFERENCES rubrics(id) ON DELETE SET NULL,
  title TEXT,
  original_path TEXT,
  presentation_path TEXT,
  thumbnail_path TEXT,
  status TEXT,
  duration_seconds NUMERIC,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE
);

-- Video chunks
CREATE TABLE IF NOT EXISTS video_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  duration_seconds NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (video_id, chunk_index)
);

-- Transcript segments (optional)
CREATE TABLE IF NOT EXISTS transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  start_seconds NUMERIC NOT NULL,
  end_seconds NUMERIC NOT NULL,
  text TEXT,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Evaluations
CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  evaluator_id UUID REFERENCES users(id),
  rubric_id UUID REFERENCES rubrics(id),
  scores JSONB NOT NULL,
  total_score NUMERIC,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_videos_workspace ON videos(workspace_id);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_rubrics_workspace ON rubrics(workspace_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_video_start ON transcript_segments(video_id, start_seconds);
CREATE INDEX IF NOT EXISTS idx_evals_video ON evaluations(video_id);
CREATE INDEX IF NOT EXISTS idx_chunks_video ON video_chunks(video_id);

-- End of migration
