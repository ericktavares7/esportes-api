import { getCampeonatos, getMinhaConta, getTabela, getArtilharia, getRodadas, getRodada } from '../services/apiFutebolService.js';
import {
  CAMPEONATO_SERIE_A_ID,
  buscarCampeonatoInfoSerieA,
  buscarTabelaSerieA,
  buscarArtilhariaSerieA,
  buscarRodadaSerieA,
} from '../services/goalApiService.js';
import { GOAL_API_KEY } from '../config/env.js';

export async function list(req, res, next) {
  try {
    // getCampeonatos traz o catalogo inteiro da API; getMinhaConta traz só
    // os IDs que o plano atual libera. Cruzando os dois, o dropdown mostra
    // só o que realmente funciona - sem opção que dá erro ao selecionar.
    const campeonatos = await getCampeonatos();

    // Série A não está no plano da API Futebol - entra à parte, como teste,
    // vindo inteiro da GOAL API (só se a chave estiver configurada). Ver
    // goalApiService.js pro que funciona e o que ainda não funciona nessa liga.
    const extras = [];
    if (GOAL_API_KEY) {
      try {
        extras.push(await buscarCampeonatoInfoSerieA());
      } catch (err) {
        console.warn('Não foi possível carregar a Série A (GOAL API) pro dropdown:', err.message);
      }
    }

    let minhaConta;
    try {
      minhaConta = await getMinhaConta();
    } catch (err) {
      // /me falhou (ex: cota estourada) e ainda não existe nenhuma cópia
      // salva pra cair como reserva. Em vez de travar a tela toda por causa
      // de uma chamada só, devolve o catálogo sem filtro - pior o dropdown
      // mostrar campeonato de mais do que travar mostrando erro.
      console.warn('Não foi possível filtrar por /me, devolvendo catálogo completo:', err.message);
      return res.json([...campeonatos, ...extras]);
    }

    const idsLiberados = new Set(minhaConta.campeonatos.map((c) => c.campeonato_id));
    const disponiveis = campeonatos.filter((c) => idsLiberados.has(c.campeonato_id));
    res.json([...disponiveis, ...extras]);
  } catch (err) {
    next(err);
  }
}

export async function tabela(req, res, next) {
  try {
    const { id } = req.params;
    const tabela = id === CAMPEONATO_SERIE_A_ID ? await buscarTabelaSerieA() : await getTabela(id);
    res.json(tabela);
  } catch (err) {
    next(err);
  }
}

export async function artilharia(req, res, next) {
  try {
    const { id } = req.params;
    const artilheiros = id === CAMPEONATO_SERIE_A_ID ? await buscarArtilhariaSerieA() : await getArtilharia(id);
    res.json(artilheiros);
  } catch (err) {
    next(err);
  }
}

export async function rodadas(req, res, next) {
  try {
    const { id } = req.params;
    if (id === CAMPEONATO_SERIE_A_ID) {
      return res.status(501).json({ error: 'Lista completa de rodadas não implementada pra Série A (teste) ainda.' });
    }
    const lista = await getRodadas(id);
    res.json(lista);
  } catch (err) {
    next(err);
  }
}

export async function rodada(req, res, next) {
  try {
    const { id, numero } = req.params;
    const detalhe = id === CAMPEONATO_SERIE_A_ID ? await buscarRodadaSerieA(numero) : await getRodada(id, numero);
    res.json(detalhe);
  } catch (err) {
    next(err);
  }
}
