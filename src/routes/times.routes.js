import { Router } from 'express';
import { forma, jogosRecentes } from '../controllers/times.controller.js';

const router = Router();

// GET /api/times/30/forma?campeonato=10&antes=38&quantidade=5
router.get('/:timeId/forma', forma);

// GET /api/times/30/jogos-recentes?campeonato=10&antes=38&limite=20
router.get('/:timeId/jogos-recentes', jogosRecentes);

export default router;
