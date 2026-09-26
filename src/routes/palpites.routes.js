import { Router } from 'express';
import { confronto, auditoria } from '../controllers/palpites.controller.js';

const router = Router();

// GET /api/palpites/confronto?campeonato=14&mandante=66&visitante=115&rodada=28
router.get('/confronto', confronto);

// GET /api/palpites/auditoria - palpites já feitos x resultado real
router.get('/auditoria', auditoria);

export default router;
