import { getCampeonatos, getTabela, getArtilharia, getRodadas, getRodada } from '../services/apiFutebolService.js';

export async function list(req, res, next) {
  try {
    const campeonatos = await getCampeonatos();
    res.json(campeonatos);
  } catch (err) {
    next(err);
  }
}

export async function tabela(req, res, next) {
  try {
    const { id } = req.params;
    const tabela = await getTabela(id);
    res.json(tabela);
  } catch (err) {
    next(err);
  }
}

export async function artilharia(req, res, next) {
  try {
    const { id } = req.params;
    const artilheiros = await getArtilharia(id);
    res.json(artilheiros);
  } catch (err) {
    next(err);
  }
}

export async function rodadas(req, res, next) {
  try {
    const { id } = req.params;
    const lista = await getRodadas(id);
    res.json(lista);
  } catch (err) {
    next(err);
  }
}

export async function rodada(req, res, next) {
  try {
    const { id, numero } = req.params;
    const detalhe = await getRodada(id, numero);
    res.json(detalhe);
  } catch (err) {
    next(err);
  }
}
