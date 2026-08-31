import { getCampeonatos, getMinhaConta, getTabela, getArtilharia, getRodadas, getRodada } from '../services/apiFutebolService.js';

export async function list(req, res, next) {
  try {
    // getCampeonatos traz o catalogo inteiro da API; getMinhaConta traz só
    // os IDs que o plano atual libera. Cruzando os dois, o dropdown mostra
    // só o que realmente funciona - sem opção que dá erro ao selecionar.
    const campeonatos = await getCampeonatos();

    let minhaConta;
    try {
      minhaConta = await getMinhaConta();
    } catch (err) {
      // /me falhou (ex: cota estourada) e ainda não existe nenhuma cópia
      // salva pra cair como reserva. Em vez de travar a tela toda por causa
      // de uma chamada só, devolve o catálogo sem filtro - pior o dropdown
      // mostrar campeonato de mais do que travar mostrando erro.
      console.warn('Não foi possível filtrar por /me, devolvendo catálogo completo:', err.message);
      return res.json(campeonatos);
    }

    const idsLiberados = new Set(minhaConta.campeonatos.map((c) => c.campeonato_id));
    const disponiveis = campeonatos.filter((c) => idsLiberados.has(c.campeonato_id));
    res.json(disponiveis);
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
