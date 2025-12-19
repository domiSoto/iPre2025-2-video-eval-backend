import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import db from '../lib/db.js';

export default function createUploadRoutes({ upload, jobsDir }) {
  const router = express.Router();

  // Endpoint para subir archivos y comenzar el proceso automatizado
  router.post('/automate', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'presentation', maxCount: 1 }]), (req, res) => {
    const files = req.files || {};
    const { workspaceId } = req.body || {};
    const audioFile = files.audio && files.audio[0];
    const presentationFile = files.presentation && files.presentation[0];

    if (!audioFile || !presentationFile) {
      if (audioFile && fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
      if (presentationFile && fs.existsSync(presentationFile.path)) fs.unlinkSync(presentationFile.path);
      return res.status(400).json({ error: 'Se requieren archivos: audio (campo audio) y presentaci\u00f3n (campo presentation)' });
    }

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const jobDir = path.join(jobsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Mover archivos subidos a la carpeta del job
    const destAudio = path.join(jobDir, audioFile.filename);
    const destPresentation = path.join(jobDir, presentationFile.filename);
    try {
      fs.renameSync(audioFile.path, destAudio);
      fs.renameSync(presentationFile.path, destPresentation);
    } catch (e) {
      fs.copyFileSync(audioFile.path, destAudio);
      fs.copyFileSync(presentationFile.path, destPresentation);
      fs.unlinkSync(audioFile.path);
      fs.unlinkSync(presentationFile.path);
    }

    // Crear metadata inicial
    const metadata = {
      jobId,
      audio: path.relative(process.cwd(), destAudio),
      presentation: path.relative(process.cwd(), destPresentation),
      status: 'queued',
      createdAt: new Date().toISOString(),
      thumbnailExists: false
    };
    const metadataPath = path.join(jobDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Insertar una fila en la tabla videos de Postgres (mejor esfuerzo).
    (async () => {
      try {
        await db.init();
        const created = await db.createVideo({
          jobExternalId: jobId,
          workspaceId: workspaceId || null,
          rubricId: null,
          title: path.basename(destAudio),
          originalPath: metadata.audio,
          presentationPath: metadata.presentation,
          thumbnailPath: path.join(jobDir, 'thumbnail.jpg'),
          status: metadata.status,
          durationSeconds: null,
          metadata
        });
        // escribir de nuevo el id de la base de datos en los metadatos para referencia
        try {
          const m = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
          m.dbId = created.id;
          fs.writeFileSync(metadataPath, JSON.stringify(m, null, 2));
        } catch (e) {}
      } catch (e) {
        // ignore DB errors to keep upload flow working without DB
        // console.error('DB insert video failed', e.message);
      }
    })();

    // Generar miniatura en segundo plano
    (function generateThumbnailBackground(mediaPath, thumbPath, metaPath) {
      const args = ['-y', '-ss', '00:00:01', '-i', mediaPath, '-frames:v', '1', '-q:v', '2', '-vf', 'scale=320:-1', thumbPath];
      const p = spawn('ffmpeg', args, { stdio: 'ignore' });
      p.on('close', (code) => {
        try {
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (code === 0 && fs.existsSync(thumbPath)) {
            m.thumbnailExists = true;
            m.thumbnailCreatedAt = new Date().toISOString();
          } else {
            m.thumbnailExists = false;
            m.thumbnailError = `ffmpeg exit ${code}`;
          }
          fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
        } catch (e) {}
      });
      p.on('error', (err) => {
        try {
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          m.thumbnailExists = false;
          m.thumbnailError = String(err.message);
          fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
        } catch (e) {}
      });
    })(destAudio, path.join(jobDir, 'thumbnail.jpg'), metadataPath);
    
    // Iniciar el proceso automatizado
    const automatePath = path.resolve(process.cwd(), 'automate.js');
    const stream = req.query.stream === 'true';
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    metadata.status = 'running';
    metadata.startedAt = new Date().toISOString();
    metadata.progress = 0;
    metadata.progressMessage = 'started';
    metadata.totalChunks = null;
    metadata.transcribedChunks = 0;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    // Ejecutar automate.js
    const child = spawn(process.execPath, [automatePath, destAudio, destPresentation, jobId], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    // Monitorear salida para actualizar progreso en metadata.json
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (stream) {
        res.write(`data: ${text.replace(/\n/g, '\\ndata: ')}\n\n`);
      } else {
        process.stdout.write(text);
      }
      try {
        const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        // Inicializa estructura para evitar duplicados
        if (!Array.isArray(meta.transcribedChunkNames)) meta.transcribedChunkNames = [];
        if (/Archivo dividido exitosamente/i.test(text)) {
          const chunksPath = path.join(jobDir, 'chunks');
          if (fs.existsSync(chunksPath)) {
            const files = fs.readdirSync(chunksPath).filter(f => /chunk_\d+\.(mp4|mp3|m4a)$/i.test(f));
            meta.totalChunks = files.length;
            meta.progress = Math.max(meta.progress || 0, 10);
            meta.progressMessage = 'split completed';
          }
        }
        const m = text.match(/Transcripci[o\u00f3]n completada para (chunk_\d+\.(mp4|mp3|m4a))/i);
        if (m) {
          const chunkName = m[1];

          // dedupe: solo contar si NO estaba
          if (!meta.transcribedChunkNames.includes(chunkName)) {
            meta.transcribedChunkNames.push(chunkName);
            meta.transcribedChunks = meta.transcribedChunkNames.length;
          } else {
            // ya contado, no hacer nada sobre el contador
          }

          if (meta.totalChunks) {
            // mantén tu reparto de pesos (si lo deseas)
            const transcribeProgress = 88 * (meta.transcribedChunks / meta.totalChunks);
            meta.progress = Math.round(2 + transcribeProgress);
          } else {
            // fallback si no hay totalChunks detectado
            meta.progress = Math.min((meta.transcribedChunks || 1) * 10 + 10, 90);
          }

          meta.progressMessage = `transcribed ${meta.transcribedChunks}/${meta.totalChunks || '?' } chunks`;
        }
        if (/Evaluando transcripciones|Evaluando transcripciones y presentaci\u00f3n|3\. Evaluando/i.test(text)) {
          meta.progress = Math.max(meta.progress || 0, 92);
          meta.progressMessage = 'evaluating';
        }
        fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
      } catch (e) {}
    });

    // Monitorear stderr (salida de error)
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stream) {
        res.write(`data: ${text.replace(/\n/g, '\\ndata: ')}\n\n`);
      } else {
        process.stderr.write(text);
      }
    });

    // Manejar cierre del proceso
    child.on('close', (code) => {
      metadata.status = code === 0 ? 'done' : 'failed';
      metadata.finishedAt = new Date().toISOString();
      metadata.exitCode = code;
      metadata.stdout = stdout;
      metadata.stderr = stderr;
      metadata.progress = code === 0 ? 100 : (metadata.progress || 100);
      metadata.progressMessage = code === 0 ? 'finished' : (metadata.progressMessage || 'failed');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      // Devolver resultado final
      const result = { jobId, code, stdout, stderr };
      if (stream) {
        res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
        res.end();
      } else {
        if (code === 0) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }
      }
    });

    // Manejar errores del proceso
    child.on('error', (err) => {
      metadata.status = 'error';
      metadata.finishedAt = new Date().toISOString();
      metadata.error = err.message;
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      if (stream) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: err.message });
      }
    });
  });

  return router;
}
