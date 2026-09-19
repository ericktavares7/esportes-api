import { GOAL_API_KEY } from '../config/env.js';
import { comCache } from '../db/cache.js';

const BASE_URL = 'https://api.goal-api.com/v1';
const UM_ANO = 365 * 24 * 60 * 60;

async function chamar(caminho) {
  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    headers: { Authorization: `Bearer ${GOAL_API_KEY}` },
  });
  const dados = await resposta.json();
  if (!resposta.ok || dados.success === false) {
    throw new Error(`GOAL API ${resposta.status}: ${JSON.stringify(dados).slice(0, 200)}`);
  }
  return dados.data;
}

// A GOAL API às vezes devolve o mesmo tipo de estatística duas vezes com
// valores diferentes num jogo (visto num teste manual, tanto em "Corners"
// quanto em "Ball Possession") - a última ocorrência foi a que bateu com a
// realidade nesse caso, por isso pegamos sempre ela. É uma amostra pequena
// pra tirar essa regra; se acontecer de vir errado com frequência, vale
// reconsiderar.
function pegarUltimaOcorrencia(lista, tipo) {
  const ocorrencias = lista.filter((s) => s.type === tipo);
  return ocorrencias.length > 0 ? ocorrencias[ocorrencias.length - 1] : null;
}

// Escanteios e cartões amarelos de uma partida específica, buscados pela
// GOAL API - fonte que se mostrou mais precisa que a API Futebol nesses dois
// campos (validado manualmente contra Sofascore/ge.globo em vários jogos).
// Devolve null (não erro) quando não acha a partida ou não tem estatística -
// isso fica em cache também, pra não ficar reprocessando o mesmo jogo sem
// dado toda vez. Erro de rede/autenticação continua sendo erro de verdade
// (não é cacheado), pra tentar de novo na próxima chamada.
export async function buscarEstatisticasPartida(goalTimeIdCasa, goalTimeIdFora, dataIsoJogo) {
  const chave = `goalapi:stats:${goalTimeIdCasa}:${goalTimeIdFora}:${dataIsoJogo.slice(0, 10)}`;

  return comCache(chave, UM_ANO, async () => {
    const resultados = await chamar(`/teams/${goalTimeIdCasa}/results?limit=30`);
    const lista = Array.isArray(resultados) ? resultados : resultados.fixtures ?? resultados.results ?? [];

    const dataAlvo = new Date(dataIsoJogo).getTime();
    // A GOAL API guarda a data em UTC e a API Futebol em horário local - dá
    // pra cair no dia anterior/seguinte dependendo do horário do jogo, por
    // isso a tolerância de 2 dias em vez de comparar a data exata.
    const jogo = lista.find((f) => {
      const awayId = f.awayTeam?.id ?? f.away?.id;
      if (awayId !== goalTimeIdFora) return false;
      const dataJogo = new Date(f.matchDate ?? f.kickoffUtc).getTime();
      return Math.abs(dataJogo - dataAlvo) <= 2 * 24 * 60 * 60 * 1000;
    });

    if (!jogo) return null;

    const stats = await chamar(`/fixtures/${jogo.id}/statistics`);
    const fullTime = stats.match?.fullTime ?? [];

    const corners = pegarUltimaOcorrencia(fullTime, 'Corners');
    const cartoes = pegarUltimaOcorrencia(fullTime, 'Yellow Cards');
    if (!corners && !cartoes) return null;

    return {
      escanteiosCasa: corners ? Number(corners.home) : null,
      escanteiosFora: corners ? Number(corners.away) : null,
      cartoesCasa: cartoes ? Number(cartoes.home) : null,
      cartoesFora: cartoes ? Number(cartoes.away) : null,
    };
  }, 'goal-api');
}

// Estatísticas completas (escanteios, cartões, finalizações, chutes no gol,
// faltas, impedimentos, posse, defesas, passes) de um fixture específico da
// Série A. Usado tanto pro "forma" de um time (buscarFormaTimeSerieA) quanto
// pro resumo de um jogo específico (buscarResumoPartidaGoal) - diferente
// de buscarEstatisticasPartida (que existe porque parte de um time_id de
// OUTRA fonte, a API Futebol, e por isso precisa achar o jogo por data),
// aqui o id do fixture já vem diretamente da lista de fixtures da própria
// liga (buscarTodasFixturesSerieA) ou dos eventos do próprio jogo. Resultado
// fica em cache "pra sempre" (jogo encerrado não muda mais).
//
// A GOAL API não tem "Red Cards" nem "Tackles" (desarmes) como tipo de
// estatística nesse plano (conferido contra jogos reais) - cartoesVermelhos*
// e desarmes* saem sempre null, não zero, pra não fingir um dado que não
// existe (ver secaoEstatisticas em public/script.js, que trata null como
// "não disponível").
export async function buscarEstatisticasFixtureSerieA(fixtureId) {
  return comCache(`goalapi:stats:fixture:v2:${fixtureId}`, UM_ANO, async () => {
    const stats = await chamar(`/fixtures/${fixtureId}/statistics`);
    const fullTime = stats.match?.fullTime ?? [];

    const numero = (tipo) => {
      const ocorrencia = pegarUltimaOcorrencia(fullTime, tipo);
      return { casa: ocorrencia ? Number(ocorrencia.home) : null, fora: ocorrencia ? Number(ocorrencia.away) : null };
    };
    const percentual = (tipo) => {
      const ocorrencia = pegarUltimaOcorrencia(fullTime, tipo);
      return {
        casa: ocorrencia ? parseInt(ocorrencia.home, 10) || 0 : null,
        fora: ocorrencia ? parseInt(ocorrencia.away, 10) || 0 : null,
      };
    };

    const corners = numero('Corners');
    const cartoes = numero('Yellow Cards');
    const finalizacoes = numero('Shots Total');
    const chutesNoGol = numero('Shots On Goal');
    const faltas = numero('Fouls');
    const impedimentos = numero('Offsides');
    const posse = percentual('Ball Possession');
    const defesas = numero('Saves');
    const passesTotais = numero('Passes Total');
    const passesCertos = numero('Passes Accurate');

    const precisaoPasse = (totais, certos) =>
      totais != null && certos != null && totais > 0 ? Math.round((certos / totais) * 100) : null;

    return {
      escanteiosCasa: corners.casa,
      escanteiosFora: corners.fora,
      cartoesCasa: cartoes.casa,
      cartoesFora: cartoes.fora,
      cartoesVermelhosCasa: null,
      cartoesVermelhosFora: null,
      finalizacoesCasa: finalizacoes.casa,
      finalizacoesFora: finalizacoes.fora,
      chutesNoGolCasa: chutesNoGol.casa,
      chutesNoGolFora: chutesNoGol.fora,
      faltasCasa: faltas.casa,
      faltasFora: faltas.fora,
      impedimentosCasa: impedimentos.casa,
      impedimentosFora: impedimentos.fora,
      posseCasa: posse.casa,
      posseFora: posse.fora,
      defesasCasa: defesas.casa,
      defesasFora: defesas.fora,
      passesTotaisCasa: passesTotais.casa,
      passesTotaisFora: passesTotais.fora,
      passesPrecisaoCasa: precisaoPasse(passesTotais.casa, passesCertos.casa),
      passesPrecisaoFora: precisaoPasse(passesTotais.fora, passesCertos.fora),
      desarmesCasa: null,
      desarmesFora: null,
    };
  }, 'goal-api');
}

// Resumo completo de um jogo específico da Série A - equivalente ao
// getSummary() da API Futebol (matches.controller.js), mas montado a partir
// da GOAL API. Duas limitações reais da fonte (não é bug, é ausência de
// dado - conferido em 13+ jogos reais): ela não devolve cartão individual
// (quem/minuto), só o agregado de amarelos, e não tem cartão vermelho nem
// desarmes como estatística nesse plano. `cartoes` por isso sempre vem com
// os arrays vazios (não dá pra listar quem tomou), e a seção de
// estatísticas usa os campos *Vermelho*/desarmes* = null em vez de 0 -
// public/script.js trata isso como "não disponível", não "zero confirmado".
export async function buscarResumoPartidaGoal(fixtureId) {
  const encontrado = await buscarFixtureGoalPorId(fixtureId);
  if (!encontrado) throw new Error(`Fixture ${fixtureId} não encontrado na GOAL API (Série A/B)`);
  const { fixture, campeonato } = encontrado;

  const [eventos, lineups, stats] = await Promise.all([
    comCache(`goalapi:eventos:${fixtureId}`, UM_ANO, () => chamar(`/fixtures/${fixtureId}/events`), 'goal-api'),
    comCache(`goalapi:lineups:${fixtureId}`, UM_ANO, () => chamar(`/fixtures/${fixtureId}/lineups`), 'goal-api'),
    buscarEstatisticasFixtureSerieA(fixtureId),
  ]);

  const golsMandante = [];
  const golsVisitante = [];
  (eventos ?? [])
    .filter((e) => e.type === 'GOAL')
    .forEach((e) => {
      // A GOAL API não marca gol contra nos eventos (nenhum valor de "info"
      // visto além de null/"Penalty" numa amostra de 13+ jogos) - por isso
      // gol_contra sempre sai false aqui, mesmo quando tiver acontecido.
      //
      // O "minuto" da API Futebol vem tipo "07:51" (minuto:segundo); a GOAL
      // API só dá o minuto cheio (ex: "17"), sem segundo - completar um
      // ":00" inventaria precisão que não temos, então só zero-preenche
      // pra 2 dígitos (garante que o sort por minuto.localeCompare, usado em
      // secaoGols/montarTextoResumoJogo, ordene certo mesmo entre minutos de
      // 1 e 2 dígitos).
      const linha = {
        minuto: String(e.time ?? '').padStart(2, '0'),
        atleta: { nome_popular: e.homeScorer ?? e.awayScorer ?? 'Desconhecido' },
        penalti: e.info === 'Penalty',
        gol_contra: false,
      };
      if (e.homeScorer) golsMandante.push(linha);
      else golsVisitante.push(linha);
    });

  const nomeTecnico = (lado) =>
    lineups?.[lado]?.coach?.[0]?.lineupPlayer ?? null;

  return {
    partida: {
      id: fixture.id,
      data: fixture.kickoffUtc,
      status: mapearStatusPartida(fixture.matchStatus),
      estadio: fixture.matchStadium ?? null,
      campeonato,
      rodada: fixture.matchRound ? `${fixture.matchRound}ª Rodada` : null,
    },
    confronto: {
      mandante: fixture.homeTeamName,
      visitante: fixture.awayTeamName,
      placar: `${fixture.homeTeamScore ?? '-'} x ${fixture.awayTeamScore ?? '-'}`,
    },
    gols: { mandante: golsMandante, visitante: golsVisitante },
    // Sempre vazio - ver aviso da função sobre a limitação de dado.
    cartoes: { amarelo: { mandante: [], visitante: [] }, vermelho: { mandante: [], visitante: [] } },
    substituicoes: { mandante: [], visitante: [] },
    estatisticas: {
      mandante: {
        posse_de_bola: `${stats.posseCasa ?? 0}%`,
        escanteios: stats.escanteiosCasa ?? 0,
        faltas: stats.faltasCasa ?? 0,
        impedimentos: stats.impedimentosCasa ?? 0,
        finalizacao: { total: stats.finalizacoesCasa ?? 0, no_gol: stats.chutesNoGolCasa ?? 0 },
        passes: { total: stats.passesTotaisCasa ?? 0, precisao: stats.passesPrecisaoCasa ?? 0 },
        desarmes: stats.desarmesCasa,
        defensivo: { defesas: stats.defesasCasa ?? 0 },
        cartoesAmarelos: stats.cartoesCasa ?? 0,
        cartoesVermelhos: stats.cartoesVermelhosCasa,
      },
      visitante: {
        posse_de_bola: `${stats.posseFora ?? 0}%`,
        escanteios: stats.escanteiosFora ?? 0,
        faltas: stats.faltasFora ?? 0,
        impedimentos: stats.impedimentosFora ?? 0,
        finalizacao: { total: stats.finalizacoesFora ?? 0, no_gol: stats.chutesNoGolFora ?? 0 },
        passes: { total: stats.passesTotaisFora ?? 0, precisao: stats.passesPrecisaoFora ?? 0 },
        desarmes: stats.desarmesFora,
        defensivo: { defesas: stats.defesasFora ?? 0 },
        cartoesAmarelos: stats.cartoesFora ?? 0,
        cartoesVermelhos: stats.cartoesVermelhosFora,
      },
    },
    escalacoes: {
      mandante: { tecnico: nomeTecnico('home') ? { nome_popular: nomeTecnico('home') } : null },
      visitante: { tecnico: nomeTecnico('away') ? { nome_popular: nomeTecnico('away') } : null },
    },
    dadosIndisponiveis: { cartoesIndividuais: true, cartoesVermelhos: true, desarmes: true },
  };
}

// --- Brasileirão Série A como teste, direto pela GOAL API ---
//
// A API Futebol não libera Série A no plano atual (só Série B). Em vez de
// pagar por upgrade sem saber se a GOAL API entrega dado bom o bastante,
// isso aqui é um teste isolado: Jogos, Tabela, Artilharia e forma/comparativo
// (via formaService.js), mapeados pro mesmo formato que o resto do app já
// espera da API Futebol (pra não precisar mexer no frontend nem em
// abrirFormaPreJogo/abrirResumo). Como é fonte única (não precisa casar time
// com outro provedor), o time_id usado em todo o app pra essa liga É o id de
// time da própria GOAL API - uma string tipo "cmr7ben..." (cuid), não um
// número como na API Futebol.
const LIGA_SERIE_A_ID = 'cmr77dvww00bfrx061thkr8z4';
const LIGA_SERIE_B_ID = 'cmr77dvww00bgrx06cb9fmnv0';
const TEMPORADA_SERIE_A = '2026';
export const CAMPEONATO_SERIE_A_ID = 'goal-serie-a';

// A lista de fixtures da GOAL API não filtra por temporada (devolve o
// histórico inteiro, 2021-2026) e o limite de página é 100. Como ela vem
// ordenada do jogo mais recente/futuro pro mais antigo, dá pra parar de
// paginar assim que uma página trouxer jogo de outro ano - evita puxar as
// ~1800 partidas de temporadas passadas que a gente não usa.
async function buscarFixturesLiga(ligaId, chaveCache) {
  return comCache(chaveCache, 30 * 60, async () => {
    const todas = [];
    let offset = 0;
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const lote = await chamar(`/leagues/${ligaId}/fixtures?limit=100&offset=${offset}`);
      const daTemporada = lote.filter((f) => f.leagueYear === TEMPORADA_SERIE_A);
      todas.push(...daTemporada);
      if (daTemporada.length < lote.length || lote.length < 100) break;
      offset += 100;
    }
    return todas;
  }, 'goal-api');
}

export async function buscarTodasFixturesSerieA() {
  return buscarFixturesLiga(LIGA_SERIE_A_ID, 'goalapi:fixtures:serieA:2026');
}

// Série B pela GOAL API - NÃO é a fonte principal dessa liga (é a API
// Futebol); só entra como reserva quando a cota diária da API Futebol
// esgota (ver buscarFormaTime em formaService.js). Mesma estrutura de
// fixtures da Série A (380 jogos, 38 rodadas em 2026).
export async function buscarTodasFixturesSerieB() {
  return buscarFixturesLiga(LIGA_SERIE_B_ID, 'goalapi:fixtures:serieB:2026');
}

// Um id de fixture da GOAL API (string cuid) pode ser da Série A ou da B (a
// B só aparece via reserva de cota) - procura nas duas listas, já em cache.
export async function buscarFixtureGoalPorId(fixtureId) {
  const [serieA, serieB] = await Promise.all([buscarTodasFixturesSerieA(), buscarTodasFixturesSerieB().catch(() => [])]);
  const daA = serieA.find((f) => f.id === fixtureId);
  if (daA) return { fixture: daA, campeonato: 'Campeonato Brasileiro Série A' };
  const daB = serieB.find((f) => f.id === fixtureId);
  if (daB) return { fixture: daB, campeonato: 'Campeonato Brasileiro Série B' };
  return null;
}

function mapearStatusPartida(matchStatus) {
  if (matchStatus === 'FINISHED') return 'finalizado';
  if (matchStatus === 'LIVE' || matchStatus === 'IN_PLAY' || matchStatus === 'HALFTIME') return 'andamento';
  return 'agendado';
}

function mapearPartidaSerieA(f) {
  const [ano, mes, dia] = (f.matchDate ?? '').split('-');
  return {
    partida_id: f.id,
    time_mandante: { time_id: f.homeTeamId, nome_popular: f.homeTeamName, sigla: null, escudo: f.teamHomeBadge },
    time_visitante: { time_id: f.awayTeamId, nome_popular: f.awayTeamName, sigla: null, escudo: f.teamAwayBadge },
    placar_mandante: f.homeTeamScore != null ? Number(f.homeTeamScore) : null,
    placar_visitante: f.awayTeamScore != null ? Number(f.awayTeamScore) : null,
    status: mapearStatusPartida(f.matchStatus),
    data_realizacao: dia && mes && ano ? `${dia}/${mes}/${ano}` : null,
    hora_realizacao: f.matchTime,
    data_realizacao_iso: f.kickoffUtc,
    rodada: `${f.matchRound}ª Rodada`,
  };
}

export async function buscarRodadaSerieA(numero) {
  const todas = await buscarTodasFixturesSerieA();
  const numeroAlvo = Number(numero);
  const daRodada = todas.filter((f) => Number(f.matchRound) === numeroAlvo);
  const partidas = daRodada
    .map(mapearPartidaSerieA)
    .sort((a, b) => (a.data_realizacao_iso ?? '').localeCompare(b.data_realizacao_iso ?? ''));

  // "Rodada anterior"/"próxima rodada" por ordem CRONOLÓGICA (data real do
  // jogo), não por número - número+1/número-1 quebra quando um confronto é
  // adiado bem além dos vizinhos numéricos da própria rodada (visto de
  // verdade: rodada 21 com jogo adiado pra 16/09, enquanto a rodada 22 já
  // tinha sido disputada em 09/08 - clicar "próxima" a partir da 21 caía na
  // 22, voltando 5 semanas no tempo em vez de avançar). Pega a rodada dona
  // do próximo/anterior jogo cronológico fora dos limites de data desta
  // rodada (min/max de todos os seus próprios jogos, não só um).
  const datasRodada = daRodada.map((f) => new Date(f.kickoffUtc).getTime()).filter((t) => !Number.isNaN(t));
  const minData = datasRodada.length > 0 ? Math.min(...datasRodada) : null;
  const maxData = datasRodada.length > 0 ? Math.max(...datasRodada) : null;

  const outras = todas.filter((f) => Number(f.matchRound) !== numeroAlvo && f.kickoffUtc);
  const rodadaDoExtremo = (lista, escolherMelhor) =>
    lista.length > 0 ? Number(lista.reduce(escolherMelhor).matchRound) : null;

  const posteriores = maxData != null ? outras.filter((f) => new Date(f.kickoffUtc).getTime() > maxData) : [];
  const anterioresCandidatos = minData != null ? outras.filter((f) => new Date(f.kickoffUtc).getTime() < minData) : [];

  const proxima = rodadaDoExtremo(posteriores, (a, b) => (new Date(a.kickoffUtc) < new Date(b.kickoffUtc) ? a : b));
  const anterior = rodadaDoExtremo(anterioresCandidatos, (a, b) => (new Date(a.kickoffUtc) > new Date(b.kickoffUtc) ? a : b));

  const todasEncerradas = partidas.length > 0 && partidas.every((p) => p.status === 'finalizado');

  return {
    nome: `${numeroAlvo}ª Rodada`,
    rodada: numeroAlvo,
    status: todasEncerradas ? 'encerrada' : 'agendada',
    rodada_anterior: anterior != null ? { rodada: anterior } : null,
    proxima_rodada: proxima != null ? { rodada: proxima } : null,
    partidas,
  };
}

// overallPromotion vem como texto livre ("Promotion - Copa Libertadores
// (Group Stage)") - aproximação por palavra-chave, não é garantido bater com
// a regra oficial de classificação de todo ano.
function mapearFaixaSerieA(overallPromotion) {
  const texto = (overallPromotion ?? '').toLowerCase();
  if (texto.includes('libertadores') && texto.includes('group')) return 'libertadores';
  if (texto.includes('libertadores')) return 'pre-libertadores';
  if (texto.includes('sul-americana') || texto.includes('sudamericana')) return 'sul-americana';
  if (texto.includes('relegation')) return 'rebaixados';
  return null;
}

export async function buscarTabelaSerieA() {
  return comCache('goalapi:tabela:serieA', 30 * 60, async () => {
    const lista = await chamar(`/leagues/${LIGA_SERIE_A_ID}/standings`);
    return lista
      .map((s) => ({
        posicao: Number(s.overallLeaguePosition),
        pontos: Number(s.overallLeaguePTS),
        jogos: Number(s.overallLeaguePlayed),
        vitorias: Number(s.overallLeagueW),
        empates: Number(s.overallLeagueD),
        derrotas: Number(s.overallLeagueL),
        saldo_gols: Number(s.overallLeagueGF) - Number(s.overallLeagueGA),
        faixa_classificacao: mapearFaixaSerieA(s.overallPromotion),
        time: { time_id: s.teamId, nome_popular: s.team?.name ?? s.teamName, sigla: null, escudo: s.team?.badge },
      }))
      .sort((a, b) => a.posicao - b.posicao);
  }, 'goal-api');
}

export async function buscarArtilhariaSerieA() {
  return comCache('goalapi:artilharia:serieA', 60 * 60, async () => {
    const lista = await chamar(`/leagues/${LIGA_SERIE_A_ID}/top-scorers?limit=30`);
    return lista
      .map((j) => ({
        atleta: { atleta_id: j.playerId ?? j.playerKey, nome_popular: j.playerName },
        time: { time_id: null, nome_popular: j.teamName, escudo: null },
        gols: Number(j.goals ?? 0),
      }))
      .sort((a, b) => b.gols - a.gols);
  }, 'goal-api');
}

export async function buscarCampeonatoInfoSerieA() {
  const todas = await buscarTodasFixturesSerieA();
  const numeros = todas.map((f) => Number(f.matchRound)).filter((n) => !Number.isNaN(n));

  // "Rodada atual" = a rodada do jogo (de qualquer rodada) mais próximo de
  // hoje, priorizando hoje/futuro sobre passado - não "menor número de
  // rodada com algo pendente". Essa segunda regra quebra quando um confronto
  // específico é adiado bem além dos outros jogos da própria rodada (visto
  // de verdade: a rodada 21 tinha 1 jogo, Botafogo x Grêmio, adiado pra
  // 16/09, enquanto a rodada 27 já tinha jogo acontecendo HOJE - a regra
  // antiga escolhia a rodada 21, escondendo o jogo de hoje).
  //
  // Prioriza estritamente o mais próximo NO FUTURO (não a menor distância
  // absoluta): um jogo de ontem e um de amanhã ficam empatados em distância
  // absoluta, mas o de amanhã é o que interessa mostrar primeiro - mesmo
  // critério já usado em chaveInicial (public/script.js) e
  // buscarFormaTimeSerieA (formaService.js) pra decidir "o que é relevante
  // agora" nessa liga.
  let rodadaAtual = null;
  if (numeros.length > 0) {
    const agora = Date.now();
    const comData = todas
      .filter((f) => !Number.isNaN(Number(f.matchRound)) && f.kickoffUtc)
      .map((f) => ({ rodada: Number(f.matchRound), diff: new Date(f.kickoffUtc).getTime() - agora }));

    const futuras = comData.filter((f) => f.diff >= 0).sort((a, b) => a.diff - b.diff);
    if (futuras.length > 0) {
      rodadaAtual = futuras[0].rodada;
    } else {
      const passadas = comData.sort((a, b) => b.diff - a.diff);
      rodadaAtual = passadas[0]?.rodada ?? Math.max(...numeros);
    }
  }

  return {
    campeonato_id: CAMPEONATO_SERIE_A_ID,
    nome: 'Campeonato Brasileiro Série A',
    nome_popular: 'Brasileirão Série A (teste)',
    slug: 'brasileirao-serie-a-teste',
    rodada_atual: rodadaAtual != null ? { rodada: rodadaAtual } : null,
  };
}
