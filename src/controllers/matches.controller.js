import { getAoVivo, getPartida } from '../services/apiFutebolService.js';
import { buscarResumoPartidaSerieA, buscarTodasFixturesSerieA } from '../services/goalApiService.js';

// partida_id é numérico na API Futebol; fixture id da Série A (GOAL API) é
// uma string cuid tipo "cmr7ben..." - mesma distinção usada em
// times.controller.js/palpites.controller.js pra decidir a fonte certa sem
// precisar de um parâmetro "campeonato" nessa rota.
function ehIdSerieA(id) {
  return Number.isNaN(Number(id));
}

export async function listLive(req, res, next) {
  try {
    const partidas = await getAoVivo();
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

    if (ehIdSerieA(id)) {
      const todas = await buscarTodasFixturesSerieA();
      const fixture = todas.find((f) => f.id === id);
      if (!fixture) return res.status(404).json({ error: 'Jogo não encontrado' });
      return res.json({
        status: fixture.matchStatus === 'FINISHED' ? 'finalizado' : fixture.matchStatus === 'SCHEDULED' ? 'agendado' : 'andamento',
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

    if (ehIdSerieA(id)) {
      const resumo = await buscarResumoPartidaSerieA(id);
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
