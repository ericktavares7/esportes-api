import { readFileSync } from 'node:fs';
import { GOAL_API_KEY } from '../config/env.js';
import { comCache } from '../db/cache.js';

// Fonte principal de dados do app pras duas ligas (Série B e Série A) -
// jogos, rodadas, tabela, artilharia, estatísticas e escalações vêm todos
// daqui. (A API Futebol só sobrou pra abrir jogos antigos que algum usuário
// salvou em "Jogos pesquisados" com o id numérico dela - ver
// matches.controller.js.)

const BASE_URL = 'https://api.goal-api.com/v1';
const UM_ANO = 365 * 24 * 60 * 60;
const TEMPORADA = '2026';

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

// --- Ligas ---
//
// O campeonato_id usado em todo o app (dropdown, URLs, cache) é esse id
// sintético; o id de liga da GOAL API fica só aqui dentro. Como a fonte é
// única, o time_id/partida_id de todo o app é o id da própria GOAL API - uma
// string tipo "cmr7ben..." (cuid), nunca um número. A ordem aqui é a ordem
// do dropdown (a primeira é a que abre por padrão).
export const CAMPEONATO_SERIE_B_ID = 'goal-serie-b';
export const CAMPEONATO_SERIE_A_ID = 'goal-serie-a';

const LIGAS = {
  [CAMPEONATO_SERIE_B_ID]: {
    ligaId: 'cmr77dvww00bgrx06cb9fmnv0',
    chaveCache: 'serieB',
    nome: 'Campeonato Brasileiro Série B',
    nomePopular: 'Brasileirão Série B',
    slug: 'brasileirao-serie-b',
  },
  [CAMPEONATO_SERIE_A_ID]: {
    ligaId: 'cmr77dvww00bfrx061thkr8z4',
    chaveCache: 'serieA',
    nome: 'Campeonato Brasileiro Série A',
    nomePopular: 'Brasileirão Série A',
    slug: 'brasileirao-serie-a',
  },
};

export function ehCampeonatoGoal(campeonatoId) {
  return Object.hasOwn(LIGAS, String(campeonatoId));
}

function exigirLiga(campeonatoId) {
  const liga = LIGAS[String(campeonatoId)];
  if (!liga) {
    const err = new Error(`Campeonato "${campeonatoId}" não é suportado`);
    err.status = 404;
    throw err;
  }
  return liga;
}

// --- Data e hora ---
//
// ATENÇÃO: matchDate e matchTime da GOAL API são em UTC (conferido contra a
// API Futebol em 330 jogos: matchTime nunca bateu com o horário local, e
// matchDate erra o dia de todo jogo que passa da meia-noite UTC, ou seja,
// qualquer jogo depois das 21h de Brasília). Só o kickoffUtc é o instante
// real do jogo - convertido pra America/Sao_Paulo, bateu com a API Futebol em
// 306 dos 330 (os outros 24 são jogos futuros em que a API Futebol só tinha
// um dia "genérico" da rodada, sem horário). Por isso o dia e a hora que o
// app mostra saem SEMPRE do kickoffUtc, nunca de matchDate/matchTime.
const FORMATO_BRASILIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function dataHoraBrasilia(kickoffUtc) {
  const instante = kickoffUtc ? new Date(kickoffUtc) : null;
  if (!instante || Number.isNaN(instante.getTime())) return { data: null, hora: null };
  const p = Object.fromEntries(FORMATO_BRASILIA.formatToParts(instante).map((parte) => [parte.type, parte.value]));
  return { data: `${p.day}/${p.month}/${p.year}`, hora: `${p.hour}:${p.minute}` };
}

// Jogo encerrado há bastante tempo não muda mais (estatísticas, eventos e
// escalação ficam em cache "pra sempre"); um que acabou de terminar pode
// ainda ter dado incompleto na fonte, então esse cache dura pouco - senão
// uma estatística parcial ficaria congelada por um ano.
function ttlPorIdade(kickoffUtc, ttlRecente = 15 * 60) {
  const idade = Date.now() - new Date(kickoffUtc ?? 0).getTime();
  return idade > 6 * 60 * 60 * 1000 ? UM_ANO : ttlRecente;
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

// Estatísticas completas (escanteios, cartões, finalizações, chutes no gol,
// faltas, impedimentos, posse, defesas, passes) de um fixture. Usado tanto
// pro "forma" de um time quanto pro resumo de um jogo específico.
//
// A GOAL API tem dois "níveis" de detalhe entre os jogos: a maioria vem com
// o pacote completo de tipos, mas ~15-20% (visto em amostra real) só traz um
// conjunto reduzido (Corners, Ball Possession, Attacks, On/Off Target...),
// sem Fouls/Yellow Cards/Shots Total/Offsides/Saves/Passes. Não existe
// substituto pra faltas, impedimentos ou desarmes nesse conjunto reduzido -
// ficam null nesses jogos (não 0, pra não fingir um dado que não existe;
// quem consome trata null como "sem dado").
//
// Dois campos ainda dá pra recuperar mesmo no conjunto reduzido:
// - finalizações/chutes no gol: "On Target"/"Off Target" aparecem em TODO
//   jogo testado (inclusive nos reduzidos) e batem com "Shots On
//   Goal"/"Shots Total" quando os dois existem (validado em 15 jogos reais:
//   On Target = Shots On Goal em 14/15, On Target + Off Target = Shots
//   Total em 13/15) - usados como reserva quando o campo "oficial" falta.
// - cartão vermelho: existe um tipo "Red Cards", só que ele NUNCA apareceu
//   com valor 0/0 numa amostra de 24 jogos reais que o tinham - some do
//   feed em vez de mostrar zero (mesmo padrão de outras federações: time
//   que não tomou vermelho simplesmente não gera essa estatística). Por
//   isso, num jogo que tem o feed completo (Yellow Cards presente) mas sem
//   "Red Cards", o valor inferido é 0, não null - só fica null quando o
//   jogo inteiro está no conjunto reduzido (sem Yellow Cards também).
// "Tackles"/desarmes não tem equivalente nem substituto - fica sempre null.
export async function buscarEstatisticasFixture(fixtureId, kickoffUtc) {
  return comCache(`goalapi:stats:fixture:v3:${fixtureId}`, ttlPorIdade(kickoffUtc), async () => {
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
    const somarPar = (a, b) => (a != null && b != null ? a + b : null);

    const corners = numero('Corners');
    const cartoes = numero('Yellow Cards');
    const cartoesVermelhos = numero('Red Cards');
    const faltas = numero('Fouls');
    const impedimentos = numero('Offsides');
    const posse = percentual('Ball Possession');
    const defesas = numero('Saves');
    const passesTotais = numero('Passes Total');
    const passesCertos = numero('Passes Accurate');

    const shotsTotal = numero('Shots Total');
    const shotsOnGoal = numero('Shots On Goal');
    const onTarget = numero('On Target');
    const offTarget = numero('Off Target');
    const finalizacoes = {
      casa: shotsTotal.casa ?? somarPar(onTarget.casa, offTarget.casa),
      fora: shotsTotal.fora ?? somarPar(onTarget.fora, offTarget.fora),
    };
    const chutesNoGol = {
      casa: shotsOnGoal.casa ?? onTarget.casa,
      fora: shotsOnGoal.fora ?? onTarget.fora,
    };

    const precisaoPasse = (totais, certos) =>
      totais != null && certos != null && totais > 0 ? Math.round((certos / totais) * 100) : null;

    return {
      escanteiosCasa: corners.casa,
      escanteiosFora: corners.fora,
      cartoesCasa: cartoes.casa,
      cartoesFora: cartoes.fora,
      cartoesVermelhosCasa: cartoesVermelhos.casa ?? (cartoes.casa != null ? 0 : null),
      cartoesVermelhosFora: cartoesVermelhos.fora ?? (cartoes.fora != null ? 0 : null),
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

// Eventos do jogo (gols com minuto/artilheiro/assistência). A GOAL API só
// devolve gols nesse endpoint - nunca cartões nem substituições, mesmo o
// esquema tendo essas categorias (conferido em dezenas de jogos reais).
function buscarEventosFixture(fixtureId, kickoffUtc) {
  return comCache(`goalapi:eventos:${fixtureId}`, ttlPorIdade(kickoffUtc, 10 * 60), () => chamar(`/fixtures/${fixtureId}/events`), 'goal-api');
}

// --- Fixtures (jogos) ---

// A lista de fixtures da GOAL API não filtra por temporada (devolve o
// histórico inteiro, 2021-2026) e o limite de página é 100. Como ela vem
// ordenada do jogo mais recente/futuro pro mais antigo, dá pra parar de
// paginar assim que uma página trouxer jogo de outro ano.
export async function buscarTodasFixtures(campeonatoId) {
  const liga = exigirLiga(campeonatoId);
  return comCache(`goalapi:fixtures:${liga.chaveCache}:${TEMPORADA}`, 30 * 60, async () => {
    const todas = [];
    let offset = 0;
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const lote = await chamar(`/leagues/${liga.ligaId}/fixtures?limit=100&offset=${offset}`);
      const daTemporada = lote.filter((f) => f.leagueYear === TEMPORADA);
      todas.push(...daTemporada);
      if (daTemporada.length < lote.length || lote.length < 100) break;
      offset += 100;
    }
    return todas;
  }, 'goal-api');
}

export function mapearStatusPartida(matchStatus) {
  if (['FINISHED', 'AFTER_ET', 'AFTER_PEN', 'AWARDED'].includes(matchStatus)) return 'finalizado';
  if (['LIVE', 'IN_PLAY', 'HALF_TIME', 'HALFTIME', 'EXTRA_TIME', 'PENALTIES'].includes(matchStatus)) return 'andamento';
  if (['POSTPONED', 'SUSPENDED', 'CANCELLED', 'ABANDONED'].includes(matchStatus)) return 'adiado';
  return 'agendado';
}

const PERIODOS = {
  FIRST_HALF: 'primeiro tempo',
  HALF_TIME: 'intervalo',
  SECOND_HALF: 'segundo tempo',
  EXTRA_TIME: 'prorrogação',
  PENALTIES: 'pênaltis',
};

// Mesmo formato de partida que o frontend sempre recebeu (nomes de campo em
// português, herdados da época da API Futebol).
function mapearPartida(f) {
  const { data, hora } = dataHoraBrasilia(f.kickoffUtc);
  return {
    partida_id: f.id,
    time_mandante: { time_id: f.homeTeamId, nome_popular: f.homeTeamName, sigla: null, escudo: f.teamHomeBadge },
    time_visitante: { time_id: f.awayTeamId, nome_popular: f.awayTeamName, sigla: null, escudo: f.teamAwayBadge },
    placar_mandante: f.homeTeamScore != null ? Number(f.homeTeamScore) : null,
    placar_visitante: f.awayTeamScore != null ? Number(f.awayTeamScore) : null,
    status: mapearStatusPartida(f.matchStatus),
    data_realizacao: data,
    hora_realizacao: hora,
    data_realizacao_iso: f.kickoffUtc,
    rodada: `${f.matchRound}ª Rodada`,
    cronometro: f.matchElapsed ?? null,
    periodo: PERIODOS[f.matchPeriod] ?? null,
    estadio: f.matchStadium ? { nome_popular: f.matchStadium } : null,
  };
}

export async function buscarRodada(campeonatoId, numero) {
  const todas = await buscarTodasFixtures(campeonatoId);
  const numeroAlvo = Number(numero);
  const daRodada = todas.filter((f) => Number(f.matchRound) === numeroAlvo);
  const partidas = daRodada
    .map(mapearPartida)
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

// --- Tabela ---

// overallPromotion vem como texto livre em inglês - aproximação por
// palavra-chave. Série B bate com o que a API Futebol mostrava (1º-2º acesso,
// 3º-6º playoffs de acesso, 17º-20º rebaixados); Série A não é garantido
// bater com a regra oficial de classificação de todo ano.
function mapearFaixa(campeonatoId, overallPromotion) {
  const texto = (overallPromotion ?? '').toLowerCase();

  if (campeonatoId === CAMPEONATO_SERIE_B_ID) {
    if (texto.includes('play off') || texto.includes('playoff')) return 'playoffs-de-acesso';
    if (texto.includes('promotion')) return 'acesso-serie-a';
    if (texto.includes('relegation')) return 'rebaixados-serie-c';
    return null;
  }

  if (texto.includes('libertadores') && texto.includes('group')) return 'libertadores';
  if (texto.includes('libertadores')) return 'pre-libertadores';
  if (texto.includes('sul-americana') || texto.includes('sudamericana')) return 'sul-americana';
  if (texto.includes('relegation')) return 'rebaixados';
  return null;
}

export async function buscarTabela(campeonatoId) {
  const liga = exigirLiga(campeonatoId);
  return comCache(`goalapi:tabela:${liga.chaveCache}`, 30 * 60, async () => {
    const lista = await chamar(`/leagues/${liga.ligaId}/standings`);
    return lista
      .map((s) => ({
        posicao: Number(s.overallLeaguePosition),
        pontos: Number(s.overallLeaguePTS),
        jogos: Number(s.overallLeaguePlayed),
        vitorias: Number(s.overallLeagueW),
        empates: Number(s.overallLeagueD),
        derrotas: Number(s.overallLeagueL),
        saldo_gols: Number(s.overallLeagueGF) - Number(s.overallLeagueGA),
        faixa_classificacao: mapearFaixa(campeonatoId, s.overallPromotion),
        time: { time_id: s.teamId, nome_popular: s.team?.name ?? s.teamName, sigla: null, escudo: s.team?.badge },
      }))
      .sort((a, b) => a.posicao - b.posicao);
  }, 'goal-api');
}

// --- Artilharia ---
//
// Calculada a partir dos eventos de gol de cada jogo encerrado, NÃO do
// endpoint /top-scorers da GOAL API: ele é comprovadamente errado (Série B:
// Perotti aparecia com 9 gols, os eventos dão 11, igual à API Futebol; Série
// A: listava Jorge Kaio com 21 e Arrascaeta com 18 enquanto os eventos dão o
// Viveros na frente com 18). Já os eventos de gol batem com o placar em 100%
// dos jogos encerrados das duas ligas (674 de 674 gols na B, 736 de 736 na
// A, conferido jogo a jogo). Gol contra não tem marcador nos eventos e por
// isso não dá pra separar aqui.
//
// Custo: 1 chamada por jogo encerrado (~280 por liga). O cache do Render é
// apagado a cada reinício/deploy, então refazer tudo do zero a cada "cold
// start" gastaria mais da metade da cota diária. Por isso existe uma BASE
// versionada (src/config/artilhariaBase.json, gerada por
// scripts/atualizar-artilharia-base.js) com os gols já apurados dos jogos
// encerrados até a data dela - em produção só busca os eventos dos jogos que
// acabaram DEPOIS da base (uma rodada = ~10 chamadas). Sem a base, calcula
// tudo do zero (funciona, só é mais caro).
const ARQUIVO_BASE_ARTILHARIA = new URL('../config/artilhariaBase.json', import.meta.url);

function carregarBaseArtilharia(campeonatoId) {
  try {
    const base = JSON.parse(readFileSync(ARQUIVO_BASE_ARTILHARIA, 'utf8'))[campeonatoId];
    if (!base) return null;
    return { fixtures: new Set(base.fixtures), artilheiros: new Map(base.artilheiros.map((a) => [a.atleta.atleta_id, a])) };
  } catch {
    return null;
  }
}

async function emLotes(itens, tamanho, fn) {
  for (let i = 0; i < itens.length; i += tamanho) {
    await Promise.all(itens.slice(i, i + tamanho).map(fn));
  }
}

async function agregarGols(campeonatoId, { usarBase }) {
  const todas = await buscarTodasFixtures(campeonatoId);
  const encerrados = todas.filter((f) => f.matchStatus === 'FINISHED');

  const base = usarBase ? carregarBaseArtilharia(campeonatoId) : null;
  const artilheiros = new Map();
  base?.artilheiros.forEach((a, chave) => artilheiros.set(chave, structuredClone(a)));
  const incluidos = new Set(base?.fixtures ?? []);
  let falhas = 0;

  await emLotes(encerrados.filter((f) => !incluidos.has(f.id)), 8, async (f) => {
    let eventos;
    try {
      eventos = await buscarEventosFixture(f.id, f.kickoffUtc);
    } catch {
      falhas += 1;
      return;
    }
    for (const e of eventos ?? []) {
      if (e.type !== 'GOAL') continue;
      const ehMandante = Boolean(e.homeScorer);
      const nome = ehMandante ? e.homeScorer : e.awayScorer;
      if (!nome) continue;
      const timeId = ehMandante ? f.homeTeamId : f.awayTeamId;
      const chave = `${timeId}|${(ehMandante ? e.homeScorerId : e.awayScorerId) ?? nome}`;
      const atual = artilheiros.get(chave) ?? {
        atleta: { atleta_id: chave, nome_popular: nome },
        time: {
          time_id: timeId,
          nome_popular: ehMandante ? f.homeTeamName : f.awayTeamName,
          escudo: ehMandante ? f.teamHomeBadge : f.teamAwayBadge,
        },
        gols: 0,
      };
      atual.gols += 1;
      artilheiros.set(chave, atual);
    }
    incluidos.add(f.id);
  });

  return { artilheiros, fixtures: [...incluidos], falhas };
}

export async function buscarArtilharia(campeonatoId) {
  const liga = exigirLiga(campeonatoId);

  const resultado = await comCache(
    `goalapi:artilharia:v2:${liga.chaveCache}`,
    (dados) => (dados.falhas > 0 ? 5 * 60 : 60 * 60),
    async () => {
      const { artilheiros, falhas } = await agregarGols(campeonatoId, { usarBase: true });
      const lista = [...artilheiros.values()]
        .sort((a, b) => b.gols - a.gols || a.atleta.nome_popular.localeCompare(b.atleta.nome_popular))
        .slice(0, 30);
      return { lista, falhas };
    },
    'goal-api',
  );

  return resultado.lista;
}

// Recalcula tudo do zero (ignora a base) e devolve no formato do arquivo da
// base - usado só por scripts/atualizar-artilharia-base.js.
export async function gerarBaseArtilharia(campeonatoId) {
  const { artilheiros, fixtures, falhas } = await agregarGols(campeonatoId, { usarBase: false });
  if (falhas > 0) throw new Error(`${falhas} jogo(s) sem eventos - base incompleta, tente de novo`);
  return {
    geradoEm: new Date().toISOString(),
    fixtures,
    artilheiros: [...artilheiros.values()].sort((a, b) => b.gols - a.gols),
  };
}

// --- Campeonatos (dropdown) ---

export async function buscarCampeonatoInfo(campeonatoId) {
  const liga = exigirLiga(campeonatoId);
  const todas = await buscarTodasFixtures(campeonatoId);
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
  // montarFormaViaFixtures (formaService.js) pra decidir "o que é relevante
  // agora".
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
    campeonato_id: campeonatoId,
    nome: liga.nome,
    nome_popular: liga.nomePopular,
    slug: liga.slug,
    rodada_atual: rodadaAtual != null ? { rodada: rodadaAtual } : null,
  };
}

// Só devolve as ligas que carregaram - se uma falhar (ex: GOAL API fora do ar
// pra ela), a outra continua aparecendo no dropdown.
export async function listarCampeonatos() {
  const resultados = await Promise.allSettled(Object.keys(LIGAS).map((id) => buscarCampeonatoInfo(id)));
  return resultados.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

// --- Ao vivo ---

// /fixtures/live devolve os jogos ao vivo do mundo inteiro (uma dúzia por
// vez, sem paginação) - filtra só as nossas ligas.
export async function buscarAoVivo() {
  return comCache('goalapi:aovivo', 20, async () => {
    const ligas = new Set(Object.values(LIGAS).map((l) => l.ligaId));
    const lista = await chamar('/fixtures/live');
    return lista.filter((f) => ligas.has(f.leagueId)).map(mapearPartida);
  }, 'goal-api');
}

// --- Resumo de um jogo específico ---

// Um id de fixture da GOAL API (string cuid) pode ser de qualquer liga -
// procura em todas, nas listas que já ficam em cache.
export async function buscarFixtureGoalPorId(fixtureId) {
  for (const [campeonatoId, liga] of Object.entries(LIGAS)) {
    const lista = await buscarTodasFixtures(campeonatoId).catch(() => []);
    const fixture = lista.find((f) => f.id === fixtureId);
    if (fixture) return { fixture, campeonato: liga.nome };
  }
  return null;
}

// Resumo completo de um jogo - mesmo formato que o frontend sempre recebeu.
// Duas limitações reais da fonte (não é bug, é ausência de dado - conferido
// em 13+ jogos reais): ela não devolve cartão individual (quem/minuto), só o
// agregado de amarelos, e não tem cartão vermelho nem desarmes como
// estatística nesse plano. `cartoes` por isso sempre vem com os arrays
// vazios (não dá pra listar quem tomou), e a seção de estatísticas usa os
// campos *Vermelho*/desarmes* = null em vez de 0 - public/script.js trata
// isso como "não disponível", não "zero confirmado".
export async function buscarResumoPartidaGoal(fixtureId) {
  const encontrado = await buscarFixtureGoalPorId(fixtureId);
  if (!encontrado) throw new Error(`Fixture ${fixtureId} não encontrado na GOAL API`);
  const { fixture, campeonato } = encontrado;

  const [eventos, lineups, stats] = await Promise.all([
    buscarEventosFixture(fixtureId, fixture.kickoffUtc),
    comCache(`goalapi:lineups:${fixtureId}`, ttlPorIdade(fixture.kickoffUtc, 10 * 60), () => chamar(`/fixtures/${fixtureId}/lineups`), 'goal-api'),
    buscarEstatisticasFixture(fixtureId, fixture.kickoffUtc),
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

  const nomeTecnico = (lado) => lineups?.[lado]?.coach?.[0]?.lineupPlayer ?? null;

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
    // cartoesVermelhos só fica indisponível de verdade quando o jogo caiu no
    // conjunto reduzido de estatísticas (ver buscarEstatisticasFixture) - nos
    // outros, o valor já vem inferido (0 quando a fonte não lista "Red
    // Cards", contagem real quando lista).
    dadosIndisponiveis: {
      cartoesIndividuais: true,
      cartoesVermelhos: stats.cartoesVermelhosCasa == null,
      desarmes: true,
    },
  };
}
