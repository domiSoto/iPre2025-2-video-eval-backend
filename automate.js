// automate.js
// Uso: node automate.js "/ruta/al/audio.mp3" (o video) "/ruta/a/presentacion.pdf"
// Ejecuta split_file.js, transcribe_chunks.js y evaluate_file.js en orden

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

if (process.argv.length < 4) {
  console.error('Uso: node automate.js "/ruta/al/audio.mp3" "/ruta/a/presentacion.pdf" [jobId]');
  process.exit(1);
}

const audioPath = process.argv[2];
const presentacionPath = process.argv[3];
const jobId = process.argv[4] || null;

// Use per-job directories to avoid collisions when multiple uploads run
const jobsRoot = path.resolve(process.cwd(), 'jobs');
const chunksDir = jobId ? path.join(jobsRoot, jobId, 'chunks') : path.resolve(process.cwd(), 'chunks');
const transcriptsDir = jobId ? path.join(jobsRoot, jobId, 'transcripts') : path.resolve(process.cwd(), 'transcripts');

// ensure directories exist
if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });
if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });

try {
  console.log('1. Dividiendo audio en chunks... (output ->', chunksDir, ')');
  spawnSync(process.execPath, ['split_file.js', audioPath, chunksDir], { stdio: 'inherit', cwd: process.cwd() });

  console.log('\n2. Transcribiendo chunks...');
  spawnSync(process.execPath, ['transcribe_chunks.js', chunksDir, transcriptsDir], { stdio: 'inherit', cwd: process.cwd() });

  console.log('\n3. Evaluando transcripciones y presentación...');
  // forward jobId to evaluation script (if provided) so it can associate results
  // with the original job and save evaluation to DB
  if (jobId) {
    spawnSync(process.execPath, ['evaluate_file.cjs', transcriptsDir, presentacionPath, jobId], { stdio: 'inherit', cwd: process.cwd() });
  } else {
    spawnSync(process.execPath, ['evaluate_file.cjs', transcriptsDir, presentacionPath], { stdio: 'inherit', cwd: process.cwd() });
  }

  console.log('\nPipeline completado.');
} catch (err) {
  console.error('Error en el pipeline:', err.message);
  process.exit(1);
}
