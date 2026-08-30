import { Router } from 'express';
import { list, tabela, artilharia, rodadas, rodada } from '../controllers/campeonatos.controller.js';

const router = Router();

// GET /api/campeonatos
router.get('/', list);

// GET /api/campeonatos/10/tabela
router.get('/:id/tabela', tabela);

// GET /api/campeonatos/10/artilharia
router.get('/:id/artilharia', artilharia);

// GET /api/campeonatos/10/rodadas
router.get('/:id/rodadas', rodadas);

// GET /api/campeonatos/10/rodadas/1
router.get('/:id/rodadas/:numero', rodada);

export default router;
