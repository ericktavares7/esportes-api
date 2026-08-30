import { getRodada, getPartida } from './apiFutebolService.js';

// Anda pelas rodadas anteriores até achar N jogos já encerrados do time,
// depois busca o detalhe completo (com estatísticas) de cada um.
export async function buscarFormaTime(campeonatoId, timeId, antesRodada, quantidade = 5) {
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
