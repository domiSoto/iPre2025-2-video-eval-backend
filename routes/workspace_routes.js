import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

export default function createWorkspaceRoutes() {
    // Crear un nuevo workspace
    router.post('/workspaces', async (req, res) => {
        const { name, description, owner, metadata } = req.body || {};
        if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
        try {
            await db.init();
            const ws = await db.createWorkspace({ name, description: description || null, owner: owner || null, metadata: metadata || {} });
            res.status(201).json(ws);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Obtener todos los workspaces
    router.get('/workspaces', async (req, res) => {
        try {
            await db.init();
            const result = await db.getWorkspaces({});
            console.log('[GET /workspaces] fetched workspaces count=', (result && result.length) || 0, 'first=', result && result[0] ? { id: result[0].id, name: result[0].name, created_at: result[0].created_at } : null);
            res.json({ workspaces: result });
        } catch (e) {
            // don't fail the entire endpoint if DB is not configured; return empty list with warning
            console.error('Workspaces list error:', e && e.stack ? e.stack : e);
            res.status(200).json({ workspaces: [], error: `DB unavailable: ${e && e.message ? e.message : String(e)}` });
        }
    });

    // Crear una nueva rúbrica para un workspace dado
    router.post('/workspaces/:workspaceId/rubrics', async (req, res) => {
        const workspaceId = req.params.workspaceId;
        const { name, description, config, criteria } = req.body || {};
        if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
        try {
            await db.init();
            const rub = await db.createRubric({ workspaceId, name, description: description || null, config: config || [] });
            // Insertar criterios si se proporcionan
            let insertedCriteria = [];
            if (Array.isArray(criteria) && criteria.length > 0) {
                // Normalizar criterios dados
                const norm = criteria.map((c, i) => ({ idx: c.idx ?? i, key: c.key ?? null, title: c.title || `criteria_${i}`, description: c.description || null, weight: c.weight ?? 0, max_score: c.max_score ?? 1 }));
                insertedCriteria = await db.createRubricCriteriaBulk(rub.id, norm);
            }
            res.status(201).json({ rubric: rub, criteria: insertedCriteria });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Obtener una rúbrica por el ID del espacio de trabajo
    router.get('/workspaces/:workspaceId/rubric', async (req, res) => {
        const { workspaceId } = req.params;
        try {
            await db.init();
            // Obtener la rúbrica asociada al workspace
            const rubric = await db.query(
                'SELECT * FROM rubrics WHERE workspace_id = $1 LIMIT 1',
                [workspaceId]
            );
            if (!rubric.rows || rubric.rows.length === 0) {
                return res.status(404).json({ error: 'No rubric found for this workspace' });
            }

            const rub = rubric.rows[0];

            // Obtener criterios asociados a esa rúbrica
            const criteria = await db.query(
                'SELECT * FROM rubric_criteria WHERE rubric_id = $1 ORDER BY idx ASC',
                [rub.id]
            );

            res.json({
                rubric: rub,
                criteria: criteria.rows
            });

        } catch (e) {
            console.error('[GET /workspaces/:workspaceId/rubric] error:', e);
            res.status(500).json({ error: e.message });
        }
    });

  return router;
}

