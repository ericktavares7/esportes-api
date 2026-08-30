import { Router } from 'express';
import { listLive, getSummary } from '../controllers/matches.controller.js';

const router = Router();

// GET /api/matches/live
router.get('/live', listLive);

// GET /api/matches/9999991/summary
router.get('/:id/summary', getSummary);

export default router;
