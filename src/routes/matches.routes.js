import { Router } from 'express';
import { listLive, getSummary, resultado } from '../controllers/matches.controller.js';

const router = Router();

// GET /api/matches/live
router.get('/live', listLive);

// GET /api/matches/9999991/summary
router.get('/:id/summary', getSummary);

// GET /api/matches/9999991/resultado
router.get('/:id/resultado', resultado);

export default router;
