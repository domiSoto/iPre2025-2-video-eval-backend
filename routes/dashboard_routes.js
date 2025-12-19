import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

export default function createDashboardRoutes({ upload, jobsDir }) {
    // Para un workspaceID dado, obtener, cantidad de evaluaciones completadas, puntuacion promedio general y puntución promedio por criterio de la rubrica
    // Ademas, devolver distribución de puntaje total y distribución de puntaje por criterio
    // Tambien devolver las ultimas 5 evealuaciones realizadas (titulo del video, nota total, fecha de creacion)
    router.get('/workspaces/:workspaceId/dashboard', async (req, res) => {
        const { workspaceId } = req.params;
        try {
            await db.init();
            // Obtener todos los videos asociados al workspace
            const videos = await db.getVideosByWorkspaceId(workspaceId);
            const videoIds = videos.map(v => v.id);
            if (videoIds.length === 0) {
                return res.json({
                    totalEvaluations: 0,
                    averageScore: 0,
                    criteriaAverages: {},
                    scoreDistribution: {},
                    criteriaDistributions: {}
                });
            }
            // Obtener todas las evaluaciones asociadas a esos videos
            const evaluations = await db.getEvaluationsByVideoIds(videoIds);
            const totalEvaluations = evaluations.length;
            if (totalEvaluations === 0) {
                return res.json({
                    totalEvaluations: 0,
                    averageScore: 0,
                    criteriaAverages: {},
                    scoreDistribution: {},
                    criteriaDistributions: {}
                });
            }
            // Calcular puntuacion promedio general
            const totalScoreSum = evaluations.reduce(
                (sum, eval_) => sum + Number(eval_.total_score || 0),
                0
            );
            const averageScore = totalScoreSum / totalEvaluations;
            // Calcular puntuacion promedio por criterio
            const criteriaSums = {};
            const criteriaCounts = {};
            evaluations.forEach(eval_ => {
                const scores = eval_.scores || {};
                for (const [key, value] of Object.entries(scores)) {
                    if (!criteriaSums[key]) {
                        criteriaSums[key] = 0;
                        criteriaCounts[key] = 0;
                    }
                    criteriaSums[key] += value;
                    criteriaCounts[key] += 1;
                }
            });
            // Devolver el promedio de los propios promedios por criterio
            const criteriaAverages = {};
            for (const key of Object.keys(criteriaSums)) {
                criteriaAverages[key] = criteriaSums[key] / criteriaCounts[key];
            }
            // Promedio final de todos los criterios
            const finalAverage = Object.values(criteriaAverages).reduce((acc, val) => acc + val, 0) / Object.keys(criteriaAverages).length;
            // Calcular distribucion de puntaje total (usar solo numeros enteros para que hayan menos segmentos)
            const scoreDistribution = {};
            evaluations.forEach(eval_ => {
                const score = Math.round(eval_.total_score || 0); // redondear el puntaje total
                scoreDistribution[score] = (scoreDistribution[score] || 0) + 1;
            });
            // Calcular distribucion de puntaje por criterio
            const criteriaDistributions = {};
            evaluations.forEach(eval_ => {
                const scores = eval_.scores || {};
                for (const [key, value] of Object.entries(scores)) {
                    if (!criteriaDistributions[key]) {
                        criteriaDistributions[key] = {};
                    }
                    criteriaDistributions[key][value] = (criteriaDistributions[key][value] || 0) + 1;
                }
            });
            // Obtener las últimas 5 evaluaciones realizadas (título del video, nota total, fecha de creación)
            const recentEvaluations = evaluations
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5)
                .map(eval_ => {
                    const video = videos.find(v => v.id === eval_.video_id) || {};
                    return {
                        videoTitle: video.title || 'Unknown',
                        totalScore: eval_.total_score || 0,
                        createdAt: eval_.created_at
                    };
                });
            // Devolver resultados
            res.json({
                totalEvaluations,
                averageScore,
                criteriaAverages: finalAverage,
                scoreDistribution,
                criteriaDistributions,
                recentEvaluations
            });
        } catch (e) {
            console.error('[GET /workspaces/:workspaceId/dashboard] error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}