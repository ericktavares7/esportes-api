import { getRodada, getPartida } from './apiFutebolService.js';
import { comCache } from '../db/cache.js';

// Anda pelas rodadas anteriores até achar N jogos já encerrados do time,
// depois busca o detalhe completo (com estatísticas) de cada um. O resultado
// agregado também fica em cache - assim, reabrir o comparativo do mesmo jogo
// não repete nem a varredura de rodadas nem as chamadas de detalhe.
//
// Se a cota acabar no meio da busca dos detalhes, aproveita os jogos que já
// deu tempo de buscar em vez de descartar tudo (Promise.allSettled, não
// Promise.all) - cada getPartida() que teve sucesso já ficou cacheado
// individualmente (1 ano, já que jogo encerrado não muda mais), então uma
// nova tentativa depois só gasta cota com o que ainda faltou. Por isso um
// resultado incompleto pega um TTL bem mais curto (2 min em vez de 30) - a
// próxima vez que alguém pedir essa forma, tenta completar de novo cedo.
// apenasComoMandante: true = só jogos em casa, false = só jogos fora,
// null/undefined = mistura os dois (comportamento original).
export async function buscarFormaTime(campeonatoId, timeId, antesRodada, quantidade = 5, apenasComoMandante = null) {
  const chave = `forma:${campeonatoId}:${timeId}:${antesRodada}:${quantidade}:${apenasComoMandante}`;

  return comCache(
    chave,
    (dados) => (dados.jogosObtidos < dados.jogosTentados ? 2 * 60 : 30 * 60),
    async () => {
      const jogosEncontrados = [];
      let numero = antesRodada - 1;

      while (numero >= 1 && jogosEncontrados.length < quantidade) {
        const rodada = await getRodada(campeonatoId, numero);
        const partidaDoTime = (rodada.partidas ?? []).find((p) => {
          if (p.status !== 'finalizado') return false;
          const ehMandante = p.time_mandante.time_id === timeId;
          const ehVisitante = p.time_visitante.time_id === timeId;
          if (!ehMandante && !ehVisitante) return false;
          if (apenasComoMandante === true && !ehMandante) return false;
          if (apenasComoMandante === false && !ehVisitante) return false;
          return true;
        });
        if (partidaDoTime) jogosEncontrados.push(partidaDoTime);
        numero -= 1;
      }

      const resultados = await Promise.allSettled(jogosEncontrados.map((jogo) => getPartida(jogo.partida_id)));
      const jogos = resultados
        .filter((r) => r.status === 'fulfilled')
        .map((r) => montarLinhaForma(r.value, timeId));

      return {
        jogos,
        medias: calcularMedias(jogos),
        jogosTentados: jogosEncontrados.length,
        jogosObtidos: jogos.length,
      };
    },
  );
}

// Prioriza o histórico específico de mando de campo (só jogos em casa pro
// mandante, só jogos fora pro visitante) - times costumam jogar bem
// diferente em casa e fora, então misturar os dois numa média só mascara
// isso. Se não houver jogos suficientes nesse recorte (início de temporada,
// time recém-promovido etc), cai pro histórico geral em vez de travar com
// pouquíssima amostra - e avisa que usou o geral via `mandoEspecifico: false`.
const AMOSTRA_MINIMA_MANDO = 4;

export async function buscarFormaComMando(campeonatoId, timeId, antesRodada, quantidade, comoMandante) {
  const especifico = await buscarFormaTime(campeonatoId, timeId, antesRodada, quantidade, comoMandante);
  if (especifico.jogosObtidos >= Math.min(AMOSTRA_MINIMA_MANDO, quantidade)) {
    return { ...especifico, mandoEspecifico: true };
  }

  const geral = await buscarFormaTime(campeonatoId, timeId, antesRodada, quantidade, null);
  return { ...geral, mandoEspecifico: false };
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
