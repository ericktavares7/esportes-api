import { Router } from 'express';
import { chat, analiseAutomatica } from '../controllers/chat.controller.js';

const router = Router();

router.post('/', chat);
router.post('/analise-automatica', analiseAutomatica);

export default router;
