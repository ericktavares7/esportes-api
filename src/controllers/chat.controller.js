import { responder } from '../services/chatService.js';
import { analisarConfrontoManual } from '../services/chatTools.js';

export async function chat(req, res, next) {
  try {
    const { mensagem, historico, provedor, apiKey, modelo, quantidadePadrao } = req.body;
    if (!mensagem || typeof mensagem !== 'string') {
      return res.status(400).json({ error: 'Campo "mensagem" é obrigatório.' });
    }
    const resultado = await responder({
      mensagem,
      historico: Array.isArray(historico) ? historico : [],
      provedor: typeof provedor === 'string' ? provedor : undefined,
      apiKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined,
      modelo: typeof modelo === 'string' && modelo.trim() ? modelo.trim() : undefined,
      quantidadePadrao: Number.isFinite(Number(quantidadePadrao)) ? Number(quantidadePadrao) : undefined,
    });
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

export async function analiseManual(req, res, next) {
  try {
    const { timeMandanteId, jogosMandanteIds, timeVisitanteId, jogosVisitanteIds } = req.body;
    if (
      !Number.isFinite(Number(timeMandanteId)) ||
      !Number.isFinite(Number(timeVisitanteId)) ||
      !Array.isArray(jogosMandanteIds) ||
      !Array.isArray(jogosVisitanteIds) ||
      jogosMandanteIds.length === 0 ||
      jogosVisitanteIds.length === 0
    ) {
      return res.status(400).json({ error: 'Selecione pelo menos um jogo de cada time.' });
    }

    const resultado = await analisarConfrontoManual({
      timeMandanteId: Number(timeMandanteId),
      jogosMandanteIds: jogosMandanteIds.map(Number),
      timeVisitanteId: Number(timeVisitanteId),
      jogosVisitanteIds: jogosVisitanteIds.map(Number),
    });

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}
