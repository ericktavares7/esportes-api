import { getPartida } from '../services/apiFutebolService.js';
import { buscarAoVivo, buscarResumoPartidaGoal, buscarFixtureGoalPorId, mapearStatusPartida } from '../services/goalApiService.js';

// Todo jogo do app é da GOAL API (id string cuid tipo "cmr7ben..."). Só um
// id NUMÉRICO é da API Futebol - sobrou apenas em "Jogos pesquisados"
// salvos antes da migração, que ainda precisam abrir/conferir o resultado.
// Essa distinção evita precisar de um parâmetro "campeonato" nessa rota.
function ehIdGoal(id) {
  return Number.isNaN(Number(id));
}

export async function listLive(req, res, next) {
  try {
    const partidas = await buscarAoVivo();
    res.json(partidas);
  } catch (err) {
    next(err);
  }
}

// Versão enxuta do getSummary, só com o que o "acertômetro" (Jogos
// Pesquisados) precisa pra conferir se a sugestão bateu com o resultado
// real - status e placar, nada de estatísticas/escalação.
export async function resultado(req, res, next) {
  try {
    const { id } = req.params;

    if (ehIdGoal(id)) {
      const encontrado = await buscarFixtureGoalPorId(id);
      if (!encontrado) return res.status(404).json({ error: 'Jogo não encontrado' });
      const { fixture } = encontrado;
      return res.json({
        status: mapearStatusPartida(fixture.matchStatus),
        placarMandante: fixture.homeTeamScore != null ? Number(fixture.homeTeamScore) : null,
        placarVisitante: fixture.awayTeamScore != null ? Number(fixture.awayTeamScore) : null,
      });
    }

    const partida = await getPartida(id);
    res.json({
      status: partida.status,
      placarMandante: partida.placar_mandante,
      placarVisitante: partida.placar_visitante,
    });
  } catch (err) {
    next(err);
  }
}

export async function getSummary(req, res, next) {
  try {
    const { id } = req.params;

    if (ehIdGoal(id)) {
      const resumo = await buscarResumoPartidaGoal(id);
      return res.json(resumo);
    }

    const partida = await getPartida(id);

    res.json({
      partida: {
        id: partida.partida_id,
        data: partida.data_realizacao_iso,
        status: partida.status,
        estadio: partida.estadio?.nome_popular ?? null,
        campeonato: partida.campeonato?.nome_popular,
        rodada: partida.rodada,
      },
      confronto: {
        mandante: partida.time_mandante.nome_popular,
        visitante: partida.time_visitante.nome_popular,
        placar: partida.placar,
      },
      gols: partida.gols,
      cartoes: partida.cartoes,
      substituicoes: partida.substituicoes,
      estatisticas: partida.estatisticas,
      escalacoes: partida.escalacoes,
    });
  } catch (err) {
    next(err);
  }
}
