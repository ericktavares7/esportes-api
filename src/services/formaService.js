import { getRodada, getPartida } from './apiFutebolService.js';
import {
  buscarEstatisticasPartida,
  buscarTodasFixturesSerieA,
  buscarEstatisticasFixtureSerieA,
  CAMPEONATO_SERIE_A_ID,
} from './goalApiService.js';
import { MAPEAMENTO_TIMES_GOAL_API } from '../config/mapeamentoGoalApi.js';
import { GOAL_API_KEY } from '../config/env.js';
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
  if (campeonatoId === CAMPEONATO_SERIE_A_ID) {
    return buscarFormaTimeSerieA(timeId, antesRodada, quantidade, apenasComoMandante);
  }

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
      const jogos = await Promise.all(
        resultados
          .filter((r) => r.status === 'fulfilled')
          .map((r) => corrigirComGoalApi(montarLinhaForma(r.value, timeId), r.value, timeId)),
      );

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

// Equivalente do buscarFormaTime, mas pra Série A (fonte única: GOAL API,
// sem API Futebol nesse campeonato - ver [[project-serie-a-test]]). Como
// buscarTodasFixturesSerieA() já traz o histórico completo da temporada em
// cache (usado por Jogos/Tabela), dá pra filtrar o time direto nele em vez
// de repetir a varredura rodada-por-rodada que a versão da API Futebol
// precisa fazer (lá, cada rodada é uma chamada separada).
async function buscarFormaTimeSerieA(timeId, antesRodada, quantidade, apenasComoMandante) {
  const chave = `forma:${CAMPEONATO_SERIE_A_ID}:${timeId}:${antesRodada}:${quantidade}:${apenasComoMandante}`;

  return comCache(
    chave,
    (dados) => (dados.jogosObtidos < dados.jogosTentados ? 2 * 60 : 30 * 60),
    async () => {
      const todas = await buscarTodasFixturesSerieA();
      const jogosDoTime = todas.filter((f) => f.homeTeamId === timeId || f.awayTeamId === timeId);
      const numeroAlvo = Number(antesRodada);

      // "antesRodada" é um NÚMERO de rodada, mas rodadas podem ser jogadas
      // fora de ordem cronológica quando um confronto é adiado - visto de
      // verdade: a 21ª rodada do Botafogo RJ ficou agendada pra 16/09,
      // enquanto as rodadas 22 a 27 dele já tinham sido disputadas entre
      // agosto e 12/09. Comparar só o número da rodada (`matchRound <
      // antesRodada`) fazia esses jogos já encerrados sumirem do
      // histórico por engano, mesmo tendo acontecido antes na realidade.
      //
      // apenasComoMandante !== null identifica quem chama: buscarFormaComMando
      // (comparativo pré-jogo) e gerarPalpites sempre passam true/false - aí
      // "antesRodada" é a rodada do confronto específico sendo analisado, e o
      // corte certo é a data real do próprio jogo desse time nessa rodada.
      // Já apenasComoMandante === null é o perfil de time (buscarFormaTime
      // puro, sem filtro de mando) - a intenção ali é "forma recente até
      // hoje", então usa a data atual direto, sem depender de rodada nenhuma.
      let dataCorte;
      if (apenasComoMandante === null) {
        dataCorte = Date.now();
      } else {
        const fixtureReferencia = jogosDoTime.find((f) => Number(f.matchRound) === numeroAlvo);
        dataCorte = fixtureReferencia ? new Date(fixtureReferencia.kickoffUtc).getTime() : Date.now();
      }

      const candidatos = jogosDoTime
        .filter((f) => f.matchStatus === 'FINISHED' && new Date(f.kickoffUtc).getTime() < dataCorte)
        .filter((f) => {
          const ehMandante = f.homeTeamId === timeId;
          if (apenasComoMandante === true && !ehMandante) return false;
          if (apenasComoMandante === false && ehMandante) return false;
          return true;
        })
        .sort((a, b) => new Date(b.kickoffUtc).getTime() - new Date(a.kickoffUtc).getTime())
        .slice(0, quantidade);

      const resultados = await Promise.allSettled(
        candidatos.map(async (fixture) => {
          const stats = await buscarEstatisticasFixtureSerieA(fixture.id);
          return montarLinhaFormaSerieA(fixture, stats, timeId);
        }),
      );
      const jogos = resultados.filter((r) => r.status === 'fulfilled').map((r) => r.value);

      return {
        jogos,
        medias: calcularMedias(jogos),
        jogosTentados: candidatos.length,
        jogosObtidos: jogos.length,
      };
    },
  );
}

function montarLinhaFormaSerieA(fixture, stats, timeId) {
  const ehMandante = fixture.homeTeamId === timeId;
  const golsPro = ehMandante ? Number(fixture.homeTeamScore) : Number(fixture.awayTeamScore);
  const golsContra = ehMandante ? Number(fixture.awayTeamScore) : Number(fixture.homeTeamScore);
  const adversario = ehMandante ? fixture.awayTeamName : fixture.homeTeamName;

  let resultado = 'E';
  if (golsPro > golsContra) resultado = 'V';
  if (golsPro < golsContra) resultado = 'D';

  // Pega o valor do lado do time (mandante/visitante) e do adversário a
  // partir do par casa/fora que buscarEstatisticasFixtureSerieA devolve.
  const pegar = (casa, fora) => (ehMandante ? casa : fora) ?? 0;
  const pegarContra = (casa, fora) => (ehMandante ? fora : casa) ?? 0;

  return {
    partidaId: fixture.id,
    data: fixture.kickoffUtc,
    adversario,
    mandante: ehMandante,
    placar: `${golsPro} x ${golsContra}`,
    resultado,
    golsPro,
    golsContra,
    escanteios: pegar(stats.escanteiosCasa, stats.escanteiosFora),
    escanteiosContra: pegarContra(stats.escanteiosCasa, stats.escanteiosFora),
    finalizacoes: pegar(stats.finalizacoesCasa, stats.finalizacoesFora),
    chutesNoGol: pegar(stats.chutesNoGolCasa, stats.chutesNoGolFora),
    faltas: pegar(stats.faltasCasa, stats.faltasFora),
    impedimentos: pegar(stats.impedimentosCasa, stats.impedimentosFora),
    cartoesAmarelos: pegar(stats.cartoesCasa, stats.cartoesFora),
    cartoesAmarelosContra: pegarContra(stats.cartoesCasa, stats.cartoesFora),
    posseDeBola: pegar(stats.posseCasa, stats.posseFora),
  };
}

function montarLinhaForma(partida, timeId) {
  const ehMandante = partida.time_mandante.time_id === timeId;
  const stats = ehMandante ? partida.estatisticas.mandante : partida.estatisticas.visitante;
  const statsAdversario = ehMandante ? partida.estatisticas.visitante : partida.estatisticas.mandante;
  const golsPro = ehMandante ? partida.placar_mandante : partida.placar_visitante;
  const golsContra = ehMandante ? partida.placar_visitante : partida.placar_mandante;
  const adversario = ehMandante ? partida.time_visitante : partida.time_mandante;
  const cartoesAmarelos = (ehMandante ? partida.cartoes?.amarelo?.mandante : partida.cartoes?.amarelo?.visitante) ?? [];
  const cartoesAmarelosAdversario = (ehMandante ? partida.cartoes?.amarelo?.visitante : partida.cartoes?.amarelo?.mandante) ?? [];

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
    // "Contra" aqui é o que o ADVERSÁRIO fez naquela mesma partida (não é
    // "escanteios sofridos" no sentido defensivo) - serve pra reconstruir o
    // total real da partida (escanteios/cartões dos dois lados somados) sem
    // precisar buscar o jogo de novo.
    escanteiosContra: statsAdversario.escanteios,
    finalizacoes: stats.finalizacao.total,
    chutesNoGol: stats.finalizacao.no_gol,
    faltas: stats.faltas,
    impedimentos: stats.impedimentos,
    cartoesAmarelos: cartoesAmarelos.length,
    cartoesAmarelosContra: cartoesAmarelosAdversario.length,
    posseDeBola: parseInt(stats.posse_de_bola, 10) || 0,
  };
}

// A API Futebol mostrou contagem errada de escanteios/cartões em vários jogos
// checados manualmente contra Sofascore/ge.globo (sempre a menos, nunca a
// mais - sugere bug de contagem na fonte deles, não aleatório). A GOAL API
// bateu certo nos mesmos jogos, então esses dois campos são sobrescritos por
// ela quando os dois times do confronto estão mapeados e ela tem o dado.
//
// Resto do jogo (placar, escalação, rodada etc.) continua vindo só da API
// Futebol, que se mostrou confiável nesses outros campos - a troca é
// cirúrgica, não uma substituição de fonte inteira. Se a GOAL API falhar,
// não tiver a chave configurada, ou o jogo não estiver nela, mantém o valor
// da API Futebol sem quebrar nada (silenciosamente pior, não ausente).
async function corrigirComGoalApi(linha, partida, timeId) {
  if (!GOAL_API_KEY) return linha;

  const goalIdMandante = MAPEAMENTO_TIMES_GOAL_API[partida.time_mandante.time_id];
  const goalIdVisitante = MAPEAMENTO_TIMES_GOAL_API[partida.time_visitante.time_id];
  if (!goalIdMandante || !goalIdVisitante) return linha;

  let stats;
  try {
    stats = await buscarEstatisticasPartida(goalIdMandante, goalIdVisitante, partida.data_realizacao_iso);
  } catch (err) {
    console.warn(`[goal-api] Falha ao corrigir escanteios/cartões da partida ${partida.partida_id}: ${err.message}`);
    return linha;
  }
  if (!stats) return linha;

  const ehMandante = partida.time_mandante.time_id === timeId;
  const escanteios = ehMandante ? stats.escanteiosCasa : stats.escanteiosFora;
  const escanteiosContra = ehMandante ? stats.escanteiosFora : stats.escanteiosCasa;
  const cartoesAmarelos = ehMandante ? stats.cartoesCasa : stats.cartoesFora;
  const cartoesAmarelosContra = ehMandante ? stats.cartoesFora : stats.cartoesCasa;

  return {
    ...linha,
    escanteios: escanteios ?? linha.escanteios,
    escanteiosContra: escanteiosContra ?? linha.escanteiosContra,
    cartoesAmarelos: cartoesAmarelos ?? linha.cartoesAmarelos,
    cartoesAmarelosContra: cartoesAmarelosContra ?? linha.cartoesAmarelosContra,
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
