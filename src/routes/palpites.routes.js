import { Router } from 'express';
import { confronto } from '../controllers/palpites.controller.js';

const router = Router();

// GET /api/palpites/confronto?campeonato=14&mandante=66&visitante=115&rodada=28
router.get('/confronto', confronto);

export default router;
