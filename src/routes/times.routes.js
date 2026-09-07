import { Router } from 'express';
import { forma } from '../controllers/times.controller.js';

const router = Router();

// GET /api/times/30/forma?campeonato=10&antes=38&quantidade=5
router.get('/:timeId/forma', forma);

export default router;
