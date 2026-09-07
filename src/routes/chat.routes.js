import { Router } from 'express';
import { chat, analiseManual } from '../controllers/chat.controller.js';

const router = Router();

router.post('/', chat);
router.post('/analise-manual', analiseManual);

export default router;
