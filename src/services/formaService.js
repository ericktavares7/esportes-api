import { buscarTodasFixtures, buscarEstatisticasFixture, ehCampeonatoGoal } from './goalApiService.js';
import { comCache } from '../db/cache.js';

// Histórico recente de um time (últimos N jogos encerrados + médias),
// montado a partir das fixtures da GOAL API. Como buscarTodasFixtures() já
// traz a temporada inteira em cache (a mesma lista de Jogos/Tabela), dá pra
// filtrar o time direto nela - sem varrer rodada por rodada. Só as
// estatísticas de cada jogo são uma chamada por jogo (cacheada por muito
// tempo depois que o jogo acaba).
//
// Se a busca de estatísticas de algum jogo falhar, aproveita os que deram
// certo em vez de descartar tudo (Promise.allSettled, não Promise.all) - cada
// estatística que teve sucesso já ficou cacheada individualmente, então uma
// nova tentativa depois só refaz o que faltou. Por isso um resultado
// incompleto pega um TTL bem mais curto (2 min em vez de 30).
//
// apenasComoMandante: true = só jogos em casa, false = só jogos fora,
// null/undefined = mistura os dois.
export async function buscarFormaTime(campeonatoId, timeId, antesRodada, quantidade = 5, apenasComoMandante = null) {
  if (!ehCampeonatoGoal(campeonatoId)) {
    const err = new Error(`Campeonato "${campeonatoId}" não é suportado`);
    err.status = 404;
    throw err;
  }

  const chave = `forma:${campeonatoId}:${timeId}:${antesRodada}:${quantidade}:${apenasComoMandante}`;

  return comCache(
    chave,
    (dados) => (dados.jogosObtidos < dados.jogosTentados ? 2 * 60 : 30 * 60),
    async () => montarFormaViaFixtures(await buscarTodasFixtures(campeonatoId), timeId, antesRodada, quantidade, apenasComoMandante),
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

async function montarFormaViaFixtures(todas, timeId, antesRodada, quantidade, apenasComoMandante) {
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
      const stats = await buscarEstatisticasFixture(fixture.id, fixture.kickoffUtc);
      return montarLinhaForma(fixture, stats, timeId);
    }),
  );
  const jogos = resultados.filter((r) => r.status === 'fulfilled').map((r) => r.value);

  return {
    jogos,
    medias: calcularMedias(jogos),
    jogosTentados: candidatos.length,
    jogosObtidos: jogos.length,
  };
}

function montarLinhaForma(fixture, stats, timeId) {
  const ehMandante = fixture.homeTeamId === timeId;
  const golsPro = ehMandante ? Number(fixture.homeTeamScore) : Number(fixture.awayTeamScore);
  const golsContra = ehMandante ? Number(fixture.awayTeamScore) : Number(fixture.homeTeamScore);
  const adversario = ehMandante ? fixture.awayTeamName : fixture.homeTeamName;

  let resultado = 'E';
  if (golsPro > golsContra) resultado = 'V';
  if (golsPro < golsContra) resultado = 'D';

  // Pega o valor do lado do time (mandante/visitante) e do adversário a
  // partir do par casa/fora que buscarEstatisticasFixture devolve. Estatística
  // que a fonte não trouxe nesse jogo fica null, NÃO 0: cerca de 12% dos
  // jogos vêm sem finalizações/faltas e 14% sem cartões amarelos, e um 0
  // falso derrubaria as médias e os mercados de over/under. Quem calcula em
  // cima (calcularMedias, calcularAlertas, motorPalpites) ignora os null.
  const pegar = (casa, fora) => (ehMandante ? casa : fora) ?? null;
  const pegarContra = (casa, fora) => (ehMandante ? fora : casa) ?? null;

  return {
    partidaId: fixture.id,
    data: fixture.kickoffUtc,
    adversario,
    mandante: ehMandante,
    placar: `${golsPro} x ${golsContra}`,
    resultado,
    golsPro,
    golsContra,
    // "Contra" é o que o ADVERSÁRIO fez naquela mesma partida (não é
    // "sofrido" no sentido defensivo) - serve pra reconstruir o total real da
    // partida (dos dois lados somados), usado pelos mercados de over/under do
    // motor de palpites (motorPalpites.js). Só existe pros campos que viram
    // mercado - faltas não tem (não é mercado hoje).
    escanteios: pegar(stats.escanteiosCasa, stats.escanteiosFora),
    escanteiosContra: pegarContra(stats.escanteiosCasa, stats.escanteiosFora),
    finalizacoes: pegar(stats.finalizacoesCasa, stats.finalizacoesFora),
    finalizacoesContra: pegarContra(stats.finalizacoesCasa, stats.finalizacoesFora),
    chutesNoGol: pegar(stats.chutesNoGolCasa, stats.chutesNoGolFora),
    chutesNoGolContra: pegarContra(stats.chutesNoGolCasa, stats.chutesNoGolFora),
    faltas: pegar(stats.faltasCasa, stats.faltasFora),
    faltasContra: pegarContra(stats.faltasCasa, stats.faltasFora),
    impedimentos: pegar(stats.impedimentosCasa, stats.impedimentosFora),
    impedimentosContra: pegarContra(stats.impedimentosCasa, stats.impedimentosFora),
    cartoesAmarelos: pegar(stats.cartoesCasa, stats.cartoesFora),
    cartoesAmarelosContra: pegarContra(stats.cartoesCasa, stats.cartoesFora),
    posseDeBola: pegar(stats.posseCasa, stats.posseFora),
  };
}

function calcularMedias(jogos) {
  if (jogos.length === 0) return null;

  const n = jogos.length;
  // Média só dos jogos que têm aquela estatística (ver montarLinhaForma) -
  // gols/resultado existem em todos, o resto pode faltar em alguns. Sem
  // NENHUM jogo com o dado, a média fica null (não 0) - um "0 faltas/jogo"
  // pareceria um valor real, quando é só ausência de dado (efeito visto de
  // verdade quando o histórico do time cai todo numa janela em que a fonte
  // não trouxe a estatística). Quem consome (public/script.js,
  // estatisticasService.js) trata null como "sem dado suficiente".
  const media = (campo) => {
    const valores = jogos.map((jogo) => jogo[campo]).filter((v) => v != null);
    if (valores.length === 0) return null;
    return Math.round((valores.reduce((total, v) => total + v, 0) / valores.length) * 10) / 10;
  };

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
