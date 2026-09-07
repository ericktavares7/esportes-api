import { getRodada, getPartida } from './apiFutebolService.js';
import { comCache, estaCache } from '../db/cache.js';

// Anda pelas rodadas anteriores até achar N jogos já encerrados do time,
// depois busca o detalhe completo (com estatísticas) de cada um. O resultado
// agregado também fica em cache - assim, reabrir o comparativo do mesmo jogo
// não repete nem a varredura de rodadas nem as chamadas de detalhe.
export async function buscarFormaTime(campeonatoId, timeId, antesRodada, quantidade = 5) {
  const chave = `forma:${campeonatoId}:${timeId}:${antesRodada}:${quantidade}`;

  return comCache(chave, 30 * 60, async () => {
    const jogosEncontrados = [];
    let numero = antesRodada - 1;

    while (numero >= 1 && jogosEncontrados.length < quantidade) {
      const rodada = await getRodada(campeonatoId, numero);
      const partidaDoTime = (rodada.partidas ?? []).find(
        (p) => p.status === 'finalizado' && (p.time_mandante.time_id === timeId || p.time_visitante.time_id === timeId),
      );
      if (partidaDoTime) jogosEncontrados.push(partidaDoTime);
      numero -= 1;
    }

    const detalhes = await Promise.all(jogosEncontrados.map((jogo) => getPartida(jogo.partida_id)));
    const jogos = detalhes.map((partida) => montarLinhaForma(partida, timeId));

    return { jogos, medias: calcularMedias(jogos) };
  });
}

// Lista os últimos jogos encerrados de um time SEM buscar o detalhe completo
// (getPartida) de cada um - só o necessário pra exibir uma lista de escolha
// (data, adversário, placar) e indicar quais já custariam 0 requisição por já
// estarem em cache. Quem decide buscar o detalhe de fato é buscarJogosPorId,
// só depois que o usuário confirma quais jogos quer.
export async function listarJogosRecentes(campeonatoId, timeId, antesRodada, limite = 20) {
  const encontrados = [];
  let numero = antesRodada - 1;

  while (numero >= 1 && encontrados.length < limite) {
    const rodada = await getRodada(campeonatoId, numero);
    const partida = (rodada.partidas ?? []).find(
      (p) => p.status === 'finalizado' && (p.time_mandante.time_id === timeId || p.time_visitante.time_id === timeId),
    );
    if (partida) encontrados.push(partida);
    numero -= 1;
  }

  return encontrados.map((p) => ({
    partidaId: p.partida_id,
    data: p.data_realizacao_iso,
    mandante: p.time_mandante.nome_popular,
    visitante: p.time_visitante.nome_popular,
    placarMandante: p.placar_mandante,
    placarVisitante: p.placar_visitante,
    emCache: estaCache(`partida:${p.partida_id}`),
  }));
}

// Mesma agregação de buscarFormaTime (jogos + médias), mas a partir de uma
// lista explícita de IDs de partida escolhida pelo usuário, em vez de
// caminhar as últimas N rodadas automaticamente.
export async function buscarJogosPorId(timeId, partidaIds) {
  const detalhes = await Promise.all(partidaIds.map((id) => getPartida(id)));
  const jogos = detalhes.map((partida) => montarLinhaForma(partida, timeId));
  return { jogos, medias: calcularMedias(jogos) };
}

function montarLinhaForma(partida, timeId) {
  const ehMandante = partida.time_mandante.time_id === timeId;
  const stats = ehMandante ? partida.estatisticas.mandante : partida.estatisticas.visitante;
  const golsPro = ehMandante ? partida.placar_mandante : partida.placar_visitante;
  const golsContra = ehMandante ? partida.placar_visitante : partida.placar_mandante;
  const adversario = ehMandante ? partida.time_visitante : partida.time_mandante;
  const cartoesAmarelos = (ehMandante ? partida.cartoes?.amarelo?.mandante : partida.cartoes?.amarelo?.visitante) ?? [];

  let resultado = 'E';
  if (golsPro > golsContra) resultado = 'V';
  if (golsPro < golsContra) resultado = 'D';

  return {
    partidaId: partida.partida_id,
    data: partida.data_realizacao_iso,
    adversario: adversario.nome_popular,
    mandante: ehMandante,
    placar: `${golsPro} x ${golsContra}`,
    resultado,
    golsPro,
    golsContra,
    escanteios: stats.escanteios,
    finalizacoes: stats.finalizacao.total,
    chutesNoGol: stats.finalizacao.no_gol,
    faltas: stats.faltas,
    impedimentos: stats.impedimentos,
    cartoesAmarelos: cartoesAmarelos.length,
    posseDeBola: parseInt(stats.posse_de_bola, 10) || 0,
  };
}

function calcularMedias(jogos) {
  if (jogos.length === 0) return null;

  const n = jogos.length;
  const soma = (campo) => jogos.reduce((total, jogo) => total + jogo[campo], 0);
  const media = (campo) => Math.round((soma(campo) / n) * 10) / 10;

  const vitorias = jogos.filter((jogo) => jogo.resultado === 'V').length;
  const empates = jogos.filter((jogo) => jogo.resultado === 'E').length;
  const derrotas = jogos.filter((jogo) => jogo.resultado === 'D').length;

  return {
    jogosAnalisados: n,
    vitorias,
    empates,
    derrotas,
    aproveitamento: Math.round(((vitorias * 3 + empates) / (n * 3)) * 100),
    mediaGolsPro: media('golsPro'),
    mediaGolsContra: media('golsContra'),
    mediaEscanteios: media('escanteios'),
    mediaFinalizacoes: media('finalizacoes'),
    mediaChutesNoGol: media('chutesNoGol'),
    mediaFaltas: media('faltas'),
    mediaImpedimentos: media('impedimentos'),
    mediaCartoesAmarelos: media('cartoesAmarelos'),
    mediaPosseDeBola: media('posseDeBola'),
  };
}
