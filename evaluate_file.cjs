// evaluate_file.cjs
// Uso: node evaluate_file.cjs <carpeta_transcripciones> <archivo_presentacion> [jobId]
// node evaluate_file.cjs ./transcripts ./presentacion.pdf 12

const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
dotenv.config();

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

const modelo = "google/gemini-2.5-pro";

// Carpeta de transcripciones
const transcripcionesDir = process.argv[2] || "./transcripts";
const presentacionPath = process.argv[3];
const jobId = process.argv[4] || null;

// Extrae el texto visual de la presentación usando extract_presentation_text.cjs
function leerPresentacion(presentacionPath) {
  if (!presentacionPath) return '';
  try {
    // Ejecuta el script externo y obtiene el texto
    const { execSync } = require('child_process');
    const output = execSync(`node ./extract_presentation_text.cjs "${presentacionPath}"`, { encoding: 'utf-8' });
    return output.trim();
  } catch (err) {
    console.error('No se pudo extraer el texto de la presentación:', err.message);
    return '';
  }
}

// Lee y concatena solo el texto de todos los .srt de la carpeta (ignora timestamps e IDs)
function leerTranscripciones(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.srt'));
  let textoCompleto = "";
  for (const file of files) {
    const contenido = fs.readFileSync(path.join(dir, file), 'utf-8');
    const lineas = contenido.split(/\r?\n/).filter(linea => {
      return linea.trim() && !/^\d+$/.test(linea.trim()) && !linea.includes('-->');
    });
    textoCompleto += lineas.join(' ') + "\n";
  }
  return textoCompleto;
}

function buildJsonInstructionFromRubric(rubric) {
  const scoresObj = rubric.criteria
    .map(c => `"${c.key || c.title.replace(/\s+/g, "_").toLowerCase()}": <1-7>`)
    .join(", ");

  const commentsObj = rubric.criteria
    .map(c => `"${c.key || c.title.replace(/\s+/g, "_").toLowerCase()}": "<comentario>"`)
    .join(", ");

  return `
IMPORTANTE: Devuelve SOLO un único objeto JSON válido sin explicaciones ni texto adicional.

El JSON debe tener la forma:

{
  "scores": { ${scoresObj} },
  "total_score": <number>,
  "comments": { ${commentsObj} },
  "summary": "<resumen final>"
}

Calcula "total_score" como el promedio ponderado usando los pesos reales de la rúbrica.
`;
}

// RÚBRICA DINÁMICA DESDE BD (fallback)
const DEFAULT_RUBRIC = {
  id: null,
  title: 'Rúbrica por defecto',
  criteria: [
    { key: 'clarity_coherence', title: 'Claridad y Coherencia de la Presentación', weight: 25, description: 'La exposición tiene una estructura lógica y clara. El presentador explica adecuadamente el flujo de la plataforma.' },
    { key: 'technical_advances', title: 'Avances Técnicos Implementados', weight: 25, description: 'Se presentan funcionalidades efectivamente nuevas y se evidencia una mejora respecto al ciclo anterior.' },
    { key: 'user_value', title: 'Valor para los Usuarios', weight: 20, description: 'Se explica el beneficio que cada nuevo módulo entrega a perfiles específicos y cómo resuelven problemas reales.' },
    { key: 'demo_quality', title: 'Calidad de la Demostración', weight: 15, description: 'La demo muestra un flujo fluido y sin errores técnicos evidentes.' },
    { key: 'oral_presentation', title: 'Presentación Oral y Manejo del Discurso', weight: 15, description: 'El presentador se expresa con claridad, confianza y ritmo adecuado.' }
  ]
};

// Construye un prompt humano legible a partir de un objeto rubric { id, title, criteria: [{key,title,weight,description}] }
function buildPromptFromRubric(rubric) {
  const header = `Quiero que actúes como un evaluador académico especializado en presentaciones de proyectos de software. A continuación, te entregaré una rúbrica detallada y luego la transcripción de una presentación oral.\n\nRÚBRICA: ${rubric.title}\n`;
  const criteriaText = rubric.criteria.map(c => {
    return `\n${c.title} (${c.weight}%):\n${c.description}\n`;
  }).join('\n');

  const scoringGuide = `\nPor favor, evalúa cada criterio con una puntuación de 1 a 7 (1 deficiente, 7 excelente). Para cada criterio entrega además un breve comentario justificando la nota.\n`;
  return header + criteriaText + scoringGuide;
}

// Obtiene la rúbrica que corresponde al jobId (busca workspace en metadata o en la tabla videos)
// Devuelve objeto { rubric, rubricId, workspaceId } donde rubric es DEFAULT_RUBRIC si no se encontró nada.
async function fetchRubricForJob(jobId) {
  // Intentamos leer metadata local primero
  let workspaceId = null;
  try {
    if (jobId) {
      const jobsMetaPath = path.join(process.cwd(), 'jobs', jobId, 'metadata.json');
      if (fs.existsSync(jobsMetaPath)) {
        const metadata = JSON.parse(fs.readFileSync(jobsMetaPath, 'utf-8'));
        if (metadata && metadata.workspaceId) workspaceId = metadata.workspaceId;
      }
    }
  } catch (e) {
    // ignore
  }

  // Import dinámico del helper DB
  let db = null;
  try {
    const dbModule = await import('./lib/db.js');
    db = dbModule.default;
    await db.init();
  } catch (e) {
    // si falla DB, devolvemos fallback
    console.warn('DB no disponible para obtener rúbrica:', e && e.message ? e.message : e);
    return { rubric: DEFAULT_RUBRIC, rubricId: null, workspaceId: workspaceId || null };
  }

  // Si no obtuvimos workspaceId del metadata, intentamos por video: workspace
  try {
    if (!workspaceId && jobId) {
      const v = await db.getVideoByJobExternalId(jobId);
      if (v && v.workspace_id) workspaceId = v.workspace_id;
      if (v.rubric_id) {
        const rb = await db.getRubricById(v.rubric_id);
        if (rb) {
          console.log("Rúbrica encontrada por rubric_id:", rb);
          return { rubric: rb, rubricId: rb.id, workspaceId };
        }
      }
    }
  } catch (e) {
    console.warn("Error buscando video:", e.message);
  }

  // Si todavía no hay workspaceId, devolvemos fallback
  if (!workspaceId) {
    console.log("No workspaceId found for jobId", jobId);
    return { rubric: DEFAULT_RUBRIC, rubricId: null, workspaceId: null };
  }

  // Intentamos traer la rúbrica activa asociada a ese workspace
  try {
    // Se asume que en lib/db.js existe una función como getActiveRubricByWorkspace(workspaceId)
    // que devuelve { id, title, criteria: [ { key, title, weight, description }, ... ] }
    const stored = await db.getActiveRubricByWorkspace(workspaceId);
    console.log("=== RUBRIC FROM DB ===");
    console.dir(stored, { depth: 10 });
    if (stored && stored.criteria && Array.isArray(stored.criteria) && stored.criteria.length > 0) {
      return { rubric: stored, rubricId: stored.id || null, workspaceId };
    } else {
      return { rubric: DEFAULT_RUBRIC, rubricId: null, workspaceId };
    }
  } catch (e) {
    console.warn('Error obteniendo rúbrica desde BD:', e && e.message ? e.message : e);
    return { rubric: DEFAULT_RUBRIC, rubricId: null, workspaceId };
  }
}

// Función principal de evaluación
async function evaluarTranscripcion() {
  const transcripcion = leerTranscripciones(transcripcionesDir);
  const textoPresentacion = leerPresentacion(presentacionPath);

  // Trae la rúbrica (o fallback)
  const { rubric, rubricId, workspaceId } = await fetchRubricForJob(jobId);
  console.log("=== RUBRIC SENT TO GEMINI ===");
  console.dir(rubric, { depth: 10 });

  // Construye el prompt a partir de la rúbrica
  let prompt = buildPromptFromRubric(rubric);
  if (textoPresentacion) {
    prompt += `\n\nCONTENIDO VISUAL DE LA PRESENTACIÓN EXTRAÍDO (diapositivas, PDF o PPT):\n${textoPresentacion}`;
  }
  prompt += `\n\nTRANSCRIPCIÓN ORAL:\n${transcripcion}`;
  prompt += buildJsonInstructionFromRubric(rubric);

  console.log("Enviando transcripción y contenido visual a Gemini...\n");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "user", content: prompt }
      ]
    })
  });

  if (response.ok) {
    const data = await response.json();
    console.log("\n=== Evaluación de Gemini ===\n");
    const evaluationText = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : JSON.stringify(data);
    console.log(evaluationText);

    // Si tenemos jobId intentamos guardar evaluación en BD (now including rubricId)
    if (jobId) {
      try {
        const jobsMetaPath = path.join(process.cwd(), 'jobs', jobId, 'metadata.json');
        let metadata = null;
        try {
          if (fs.existsSync(jobsMetaPath)) {
            metadata = JSON.parse(fs.readFileSync(jobsMetaPath, 'utf-8'));
          }
        } catch (e) {}

        // dynamic import of DB helper (ESM) from CommonJS
        const dbModule = await import('./lib/db.js');
        const db = dbModule.default;
        try {
          await db.init();
        } catch (e) {
          console.error('DB init failed, skipping DB save:', e.message);
        }

        // determine videoId: prefer DB id in metadata, otherwise try lookup by jobExternalId
        let videoId = (metadata && metadata.dbId) ? metadata.dbId : null;
        if (!videoId) {
          try {
            const v = await db.getVideoByJobExternalId(jobId);
            if (v) videoId = v.id;
          } catch (e) {
            // ignore lookup errors, leave videoId null
          }
        }

        if (videoId) {
          // parse JSON
          let parsed = null;
          try {
            parsed = JSON.parse(evaluationText);
          } catch (e) {
            const first = evaluationText.indexOf('{');
            const last = evaluationText.lastIndexOf('}');
            if (first !== -1 && last !== -1 && last > first) {
              try { parsed = JSON.parse(evaluationText.slice(first, last + 1)); } catch (e2) { parsed = null; }
            }
          }

          const scores = parsed && parsed.scores ? parsed.scores : {};
          const totalScore = parsed && (parsed.total_score || parsed.totalScore) ? (parsed.total_score || parsed.totalScore) : null;
          const comments = parsed && parsed.comments ? parsed.comments : (parsed && parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : null);
          const summary = parsed && parsed.summary ? parsed.summary : (parsed && parsed.notes && typeof parsed.notes === 'string' ? parsed.notes : null);

          // Build notes payload
          let notesToStore = null;
          if (comments || summary) {
            const payload = { comments: comments || {}, summary: summary || '' };
            notesToStore = payload;
          } else if (parsed && parsed.notes && typeof parsed.notes === 'object') {
            notesToStore = parsed.notes;
          } else if (parsed && parsed.notes && typeof parsed.notes === 'string') {
            notesToStore = { raw: parsed.notes };
          } else {
            notesToStore = { raw: evaluationText };
          }

          try {
            // insertEvaluation now includes rubricId if available
            await db.insertEvaluation({
              videoId,
              evaluatorId: null,
              rubricId: rubricId || null,
              scores: scores,
              totalScore: totalScore,
              notes: notesToStore
            });
            console.log('Evaluación guardada en la base de datos para videoId=', videoId);
          } catch (e) {
            console.error('Error guardando evaluación en DB:', e.message);
          }
        } else {
          console.warn('No se pudo determinar videoId para jobId', jobId, '- evaluación no guardada en BD.');
        }
      } catch (err) {
        console.error('Error al intentar guardar evaluación en BD:', err && err.message ? err.message : String(err));
      }
    }
  } else {
    console.error(`Error ${response.status}:`, await response.text());
  }
}

// Ejecutar la función si este script se invoca directamente
if (require.main === module) {
  evaluarTranscripcion().catch(err => {
    console.error('Error en evaluación:', err);
    process.exit(1);
  });
}
