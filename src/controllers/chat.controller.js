import { responder } from '../services/chatService.js';
import { analisarConfronto } from '../services/chatTools.js';

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

export async function analiseAutomatica(req, res, next) {
  try {
    const { timeMandanteId, timeVisitanteId, numeroRodada, quantidade } = req.body;
    if (
      !Number.isFinite(Number(timeMandanteId)) ||
      !Number.isFinite(Number(timeVisitanteId)) ||
      !Number.isFinite(Number(numeroRodada))
    ) {
      return res.status(400).json({ error: 'timeMandanteId, timeVisitanteId e numeroRodada são obrigatórios.' });
    }

    const resultado = await analisarConfronto(
      {
        timeMandanteId: Number(timeMandanteId),
        timeVisitanteId: Number(timeVisitanteId),
        numeroRodada: Number(numeroRodada),
        quantidade: quantidade ? Number(quantidade) : undefined,
      },
      {},
    );

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}
