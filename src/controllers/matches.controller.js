import { getAoVivo, getPartida } from '../services/apiFutebolService.js';

export async function listLive(req, res, next) {
  try {
    const partidas = await getAoVivo();
    res.json(partidas);
  } catch (err) {
    next(err);
  }
}

export async function getSummary(req, res, next) {
  try {
    const { id } = req.params;
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
