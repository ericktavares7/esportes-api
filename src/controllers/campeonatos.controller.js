import {
  ehCampeonatoGoal,
  listarCampeonatos,
  buscarTabela,
  buscarArtilharia,
  buscarRodada,
} from '../services/goalApiService.js';

// Todos os campeonatos do app vêm da GOAL API (ver goalApiService.js) - um
// id que não é de uma das ligas dela (ex: um link antigo com o id numérico
// da API Futebol) simplesmente não existe mais.
function campeonatoNaoSuportado(res, id) {
  return res.status(404).json({ error: `Campeonato "${id}" não é suportado.` });
}

export async function list(req, res, next) {
  try {
    res.json(await listarCampeonatos());
  } catch (err) {
    next(err);
  }
}

export async function tabela(req, res, next) {
  try {
    const { id } = req.params;
    if (!ehCampeonatoGoal(id)) return campeonatoNaoSuportado(res, id);
    res.json(await buscarTabela(id));
  } catch (err) {
    next(err);
  }
}

export async function artilharia(req, res, next) {
  try {
    const { id } = req.params;
    if (!ehCampeonatoGoal(id)) return campeonatoNaoSuportado(res, id);
    res.json(await buscarArtilharia(id));
  } catch (err) {
    next(err);
  }
}

export async function rodadas(req, res) {
  res.status(501).json({ error: 'Lista completa de rodadas não implementada.' });
}

export async function rodada(req, res, next) {
  try {
    const { id, numero } = req.params;
    if (!ehCampeonatoGoal(id)) return campeonatoNaoSuportado(res, id);
    res.json(await buscarRodada(id, numero));
  } catch (err) {
    next(err);
  }
}
