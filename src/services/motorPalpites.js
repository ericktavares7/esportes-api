// Motor de análise de palpites v2 (casa/fora + janela recente por mando).
// Implementa a "Especificação: Motor de Análise de Palpites v2" combinada com
// o usuário. Diferenças principais em relação à v1:
// - Cada mercado é testado em VÁRIAS linhas e nas DUAS direções; vale a melhor
//   combinação (maior nível de confiança; empate -> a linha mais perto do
//   valor esperado, que é a mais informativa; a "mais de 0.5 gol" trivial não
//   ganha só por ser 100%).
// - A consistência é medida por time, jogo a jogo, na MESMA linha/direção:
//   "mandante bateu em 4/4 jogos em casa, visitante em 3/5 fora". A tabela de
//   confiança usa esses percentuais (85% / 70% / 60%) e o tamanho de amostra.
// - Redundância entre mercados (ex: "vitória" + "1X") é marcada e a
//   combinação sugerida só empilha mercados independentes e não contraditórios.
// - `odd_justa` (1/probabilidade estimada) deixa o usuário comparar com a odd
//   real da casa; a GOAL API não traz odds, então `valor_estimado` fica null.
//
// Interpretações que a spec deixa em aberto:
// - "outlier" = valor acima de média + 1.5 x desvio padrão da série; mostra-se
//   a média com e sem ele (analisarAmostra) e forte nunca convive com outlier.
// - "variância baixa" = nenhum jogo se afasta mais de 50% da própria média.
// - Janela de 8 jogos por mando (spec: 5 a 10) - equilíbrio com a cota diária
//   da GOAL API, já que cada jogo novo custa uma chamada de estatísticas.
// - Sem amostra de 5+ jogos em algum dos lados o palpite leva `dado_fraco` e
//   desce um nível; abaixo de 4 num dos lados é "fraco" direto.

import { buscarFormaTime } from './formaService.js';
import { buscarTabela, buscarTodasFixtures } from './goalApiService.js';
import { registrarPalpites } from './auditoriaPalpites.js';

const JOGOS_JANELA = 8;
const AMOSTRA_MINIMA = 4; // abaixo disso em qualquer lado => fraco / não recomendar
const AMOSTRA_BOA = 5; // exigida pra forte; abaixo disso vira dado_fraco
const AMOSTRA_ESCANTEIOS_FORTE = 7;

const NIVEIS = ['fraco', 'moderado', 'moderado-forte', 'forte'];
const rebaixar = (nivel, qtd = 1) => NIVEIS[Math.max(NIVEIS.indexOf(nivel) - qtd, 0)];

const LINHAS = {
  golsPro: [1.5, 2.5, 3.5, 4.5],
  escanteios: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  cartoesAmarelos: [2.5, 3.5, 4.5, 5.5, 6.5],
  finalizacoes: [19.5, 21.5, 23.5, 25.5, 27.5, 29.5],
  chutesNoGol: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
  impedimentos: [2.5, 3.5, 4.5, 5.5],
  faltas: [19.5, 21.5, 23.5, 25.5, 27.5, 29.5],
};
const LINHAS_GOLS_TIME = [0.5, 1.5, 2.5];
const FAIXAS_GOLS = [[1, 3], [1, 4], [2, 4], [2, 5]];
const LINHAS_HANDICAP_ESCANTEIOS = [0.5, 1.5, 2.5, 3.5];

const ROTULOS = {
  golsPro: 'Total de Gols',
  escanteios: 'Total de Escanteios',
  cartoesAmarelos: 'Total de Cartões Amarelos',
  finalizacoes: 'Total de Finalizações',
  chutesNoGol: 'Total de Chutes no Gol',
  impedimentos: 'Total de Impedimentos',
  faltas: 'Total de Faltas',
};
// Campo do total (favor + contra) -> campo "contra" da linha de forma.
const CAMPO_CONTRA = {
  golsPro: 'golsContra',
  escanteios: 'escanteiosContra',
  cartoesAmarelos: 'cartoesAmarelosContra',
  finalizacoes: 'finalizacoesContra',
  chutesNoGol: 'chutesNoGolContra',
  impedimentos: 'impedimentosContra',
  faltas: 'faltasContra',
};

const CONTEXTO_FAIXA = {
  rebaixados: 'briga_rebaixamento',
  'rebaixados-serie-c': 'briga_rebaixamento',
  'acesso-serie-a': 'briga_acesso_titulo',
  'playoffs-de-acesso': 'briga_acesso_titulo',
  libertadores: 'briga_acesso_titulo',
  'pre-libertadores': 'briga_acesso_titulo',
  'sul-americana': 'briga_acesso_titulo',
};

function contextoDoTime(linhaTabela) {
  return CONTEXTO_FAIXA[linhaTabela?.faixa_classificacao] ?? 'meio_tabela_sem_pressao';
}

function arredondar(valor) {
  return Math.round(valor * 100) / 100;
}

function media(valores) {
  return valores.reduce((soma, v) => soma + v, 0) / valores.length;
}

function desvioPadrao(valores, mediaValor) {
  const variancia = valores.reduce((soma, v) => soma + (v - mediaValor) ** 2, 0) / valores.length;
  return Math.sqrt(variancia);
}

// Média + detecção de outlier. Só troca a média principal pela versão sem
// outlier se a diferença entre as duas passar de 30%.
function analisarAmostra(valores) {
  if (valores.length === 0) {
    return { media: null, mediaComOutlier: null, outlierDetectado: false, amostra: 0, desvioRelativoMax: null };
  }

  const mediaCompleta = media(valores);
  const desvio = desvioPadrao(valores, mediaCompleta);
  const limiar = mediaCompleta + 1.5 * desvio;
  const semOutliers = valores.filter((v) => v <= limiar);

  const desvioRelativoMax = mediaCompleta > 0
    ? Math.max(...valores.map((v) => Math.abs(v - mediaCompleta) / mediaCompleta))
    : 0;

  const base = { amostra: valores.length, desvioRelativoMax };
  if (semOutliers.length === valores.length || semOutliers.length === 0) {
    return { ...base, media: arredondar(mediaCompleta), mediaComOutlier: arredondar(mediaCompleta), outlierDetectado: false };
  }

  const mediaSemOutlier = media(semOutliers);
  const diferencaPct = mediaCompleta === 0 ? 0 : Math.abs(mediaCompleta - mediaSemOutlier) / mediaCompleta;
  if (diferencaPct > 0.3) {
    return { ...base, media: arredondar(mediaSemOutlier), mediaComOutlier: arredondar(mediaCompleta), outlierDetectado: true };
  }
  return { ...base, media: arredondar(mediaCompleta), mediaComOutlier: arredondar(mediaCompleta), outlierDetectado: false };
}

// Tabela de confiança (seção 4). Cada lado (mandante/visitante) traz
// { hit, n }: em quantos dos n jogos daquele time o critério bateu.
//  - fraco: algum lado com < 4 jogos, ou algum lado abaixo de 60%
//  - forte: os dois >= 85%, 5+ jogos de cada lado, sem outlier
//  - moderado-forte: os dois >= 70%, ou um lado >= 85% e o outro >= 60%
//  - moderado: os dois >= 60%
// Amostra < 5 num dos lados = dado_fraco e desce um nível. Escanteios (o mais
// volátil) só chega em forte com 7+ jogos dos dois lados e variância baixa.
function classificar({ ladoA, ladoB, outlier, varianciaBaixa, ehEscanteios }) {
  const nA = ladoA.n;
  const nB = ladoB.n;
  const pA = nA > 0 ? ladoA.hit / nA : 0;
  const pB = nB > 0 ? ladoB.hit / nB : 0;
  const menorPct = Math.min(pA, pB);
  const dadoFraco = Math.min(nA, nB) < AMOSTRA_BOA;

  if (Math.min(nA, nB) < AMOSTRA_MINIMA || menorPct < 0.6) {
    return { confianca: 'fraco', dadoFraco, pA, pB };
  }

  let confianca = 'moderado';
  if (menorPct >= 0.7 || Math.max(pA, pB) >= 0.85) confianca = 'moderado-forte';
  if (menorPct >= 0.85 && !dadoFraco && !outlier) confianca = 'forte';

  if (ehEscanteios && confianca === 'forte') {
    const amostraOk = nA >= AMOSTRA_ESCANTEIOS_FORTE && nB >= AMOSTRA_ESCANTEIOS_FORTE;
    if (!amostraOk || !varianciaBaixa) confianca = 'moderado-forte';
  }
  if (dadoFraco) confianca = rebaixar(confianca);

  return { confianca, dadoFraco, pA, pB };
}

const fmtLado = (lado) => `${lado.n > 0 ? Math.round((lado.hit / lado.n) * 100) : 0}% (${lado.hit}/${lado.n} jogos)`;

function contar(jogos, valorFn, testeFn) {
  const valores = jogos.map(valorFn).filter((v) => v != null);
  return { hit: valores.filter(testeFn).length, n: valores.length };
}

// Desempate entre candidatos do mesmo mercado: maior nível, depois a linha
// mais próxima do valor esperado (a mais informativa), depois o maior piso de
// consistência.
function escolherMelhor(candidatos) {
  const validos = candidatos.filter(Boolean);
  if (validos.length === 0) return null;
  validos.sort((a, b) => {
    const dNivel = NIVEIS.indexOf(b.avaliacao.confianca) - NIVEIS.indexOf(a.avaliacao.confianca);
    if (dNivel !== 0) return dNivel;
    const dDist = (a.distancia ?? 0) - (b.distancia ?? 0);
    if (Math.abs(dDist) > 1e-9) return dDist;
    return Math.min(b.avaliacao.pA, b.avaliacao.pB) - Math.min(a.avaliacao.pA, a.avaliacao.pB);
  });
  return validos[0];
}

// Monta o objeto final de palpite a partir do melhor candidato.
function montarPalpite({ mercado, direcao, linha, candidato, nomeMandante, nomeVisitante, textoA, textoB, meta, avisosExtras = [] }) {
  const { avaliacao, ladoA, ladoB, outlier } = candidato;
  const prob = (avaliacao.pA + avaliacao.pB) / 2;
  const avisos = [...avisosExtras];
  if (avaliacao.dadoFraco) avisos.push('Amostra menor que 5 jogos em algum dos lados (dado_fraco): confiança rebaixada um nível.');
  if (outlier) avisos.push('Outlier na amostra: a média principal usa o valor sem o jogo atípico.');

  if (prob > 0 && 1 / prob < 1.2) avisos.push('Odd justa abaixo de 1.20: palpite "seguro" demais, dificilmente a casa paga o suficiente pra ter valor.');

  // Contradição: um time aponta forte pra direção, o outro é contra.
  const maior = Math.max(avaliacao.pA, avaliacao.pB);
  const menor = Math.min(avaliacao.pA, avaliacao.pB);
  const contradicao = maior >= 0.7 && menor <= 0.4;
  let confianca = avaliacao.confianca;
  if (contradicao) {
    confianca = rebaixar(confianca);
    avisos.push('Os dois times apontam em direções opostas (contradição): confiança rebaixada.');
  }

  return {
    mercado,
    linha_sugerida: linha,
    direcao,
    confianca,
    probabilidade_estimada: Math.round(prob * 100),
    odd_justa: prob > 0 ? arredondar(1 / prob) : null,
    consistencia_mandante: fmtLado(ladoA),
    consistencia_visitante: fmtLado(ladoB),
    justificativa: `${nomeMandante} (casa): ${textoA}. ${nomeVisitante} (fora): ${textoB}.`,
    amostra_time_a: ladoA.n,
    amostra_time_b: ladoB.n,
    outlier_detectado: !!outlier,
    dado_fraco: avaliacao.dadoFraco,
    contradicao_detectada: contradicao,
    redundante_com: [],
    valor_estimado: null,
    avisos,
    meta,
  };
}

// Mercados de total (gols, escanteios, cartões, ...): testa cada linha nas
// duas direções contando, jogo a jogo de CADA time, quantas partidas (o que o
// time fez + o que o adversário fez ali) passaram/ficaram abaixo da linha.
function calcularMercadoTotal({ campo, jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }) {
  const campoContra = CAMPO_CONTRA[campo];
  const totalDe = (j) => (j[campo] != null && j[campoContra] != null ? j[campo] + j[campoContra] : null);

  const seriesA = jogosMandante.map(totalDe).filter((v) => v != null);
  const seriesB = jogosVisitante.map(totalDe).filter((v) => v != null);
  if (seriesA.length === 0 || seriesB.length === 0) return null;

  const anA = analisarAmostra(seriesA);
  const anB = analisarAmostra(seriesB);
  const outlier = anA.outlierDetectado || anB.outlierDetectado;
  const varianciaBaixa = anA.desvioRelativoMax <= 0.5 && anB.desvioRelativoMax <= 0.5;
  const esperado = (anA.media + anB.media) / 2;

  const candidatos = [];
  for (const linha of LINHAS[campo]) {
    for (const direcao of ['mais de', 'menos de']) {
      const teste = direcao === 'mais de' ? (v) => v > linha : (v) => v < linha;
      const ladoA = contar(jogosMandante, totalDe, teste);
      const ladoB = contar(jogosVisitante, totalDe, teste);
      candidatos.push({
        direcao, linha, ladoA, ladoB, outlier,
        distancia: Math.abs(linha - esperado),
        avaliacao: classificar({ ladoA, ladoB, outlier, varianciaBaixa, ehEscanteios: campo === 'escanteios' }),
      });
    }
  }

  const melhor = escolherMelhor(candidatos);
  const unidade = ROTULOS[campo].replace('Total de ', '').toLowerCase();
  const avisosExtras = campo === 'escanteios'
    ? ['Escanteios é o mercado mais volátil: só chega em forte com 7+ jogos de cada lado e variância baixa.']
    : [];
  const textoMedia = (an) => `média de ${an.media} ${unidade} por jogo${an.outlierDetectado ? ` (${an.mediaComOutlier} contando o jogo atípico)` : ''}`;
  const verbo = melhor.direcao === 'mais de' ? 'acima' : 'abaixo';

  return montarPalpite({
    mercado: ROTULOS[campo],
    direcao: melhor.direcao,
    linha: melhor.linha,
    candidato: melhor,
    nomeMandante, nomeVisitante,
    textoA: `${textoMedia(anA)}, ${melhor.ladoA.hit}/${melhor.ladoA.n} jogos ${verbo} de ${melhor.linha}`,
    textoB: `${textoMedia(anB)}, ${melhor.ladoB.hit}/${melhor.ladoB.n} jogos ${verbo} de ${melhor.linha}`,
    meta: { tipo: campo === 'golsPro' ? 'total_gols' : 'total', campo, linha: melhor.linha, direcao: melhor.direcao },
    avisosExtras,
  });
}

// Faixas de gols totais (1-3, 1-4...): "dentro" da faixa.
function calcularFaixaGols({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }) {
  const totalDe = (j) => j.golsPro + j.golsContra;
  const anA = analisarAmostra(jogosMandante.map(totalDe));
  const anB = analisarAmostra(jogosVisitante.map(totalDe));
  if (anA.amostra === 0 || anB.amostra === 0) return null;
  const outlier = anA.outlierDetectado || anB.outlierDetectado;
  const varianciaBaixa = anA.desvioRelativoMax <= 0.5 && anB.desvioRelativoMax <= 0.5;
  const esperado = (anA.media + anB.media) / 2;

  const candidatos = FAIXAS_GOLS.map(([min, max]) => {
    const teste = (v) => v >= min && v <= max;
    const ladoA = contar(jogosMandante, totalDe, teste);
    const ladoB = contar(jogosVisitante, totalDe, teste);
    return {
      min, max, ladoA, ladoB, outlier,
      distancia: Math.abs((min + max) / 2 - esperado),
      avaliacao: classificar({ ladoA, ladoB, outlier, varianciaBaixa, ehEscanteios: false }),
    };
  });
  const melhor = escolherMelhor(candidatos);

  return montarPalpite({
    mercado: 'Faixa de Gols',
    direcao: `entre ${melhor.min} e ${melhor.max} gols`,
    linha: null,
    candidato: melhor,
    nomeMandante, nomeVisitante,
    textoA: `${melhor.ladoA.hit}/${melhor.ladoA.n} jogos com ${melhor.min} a ${melhor.max} gols no total`,
    textoB: `${melhor.ladoB.hit}/${melhor.ladoB.n} jogos com ${melhor.min} a ${melhor.max} gols no total`,
    meta: { tipo: 'faixa_gols', min: melhor.min, max: melhor.max },
  });
}

// Gols de UM time: o lado A é quanto o próprio time marca; o lado B, quanto o
// adversário costuma sofrer (gols contra dele nos jogos dele no mando oposto).
function calcularGolsTime({ jogosTime, jogosAdversario, nomeTime, nomeAdversario, timeEhMandante }) {
  const anProprio = analisarAmostra(jogosTime.map((j) => j.golsPro));
  const anAdversario = analisarAmostra(jogosAdversario.map((j) => j.golsContra));
  if (anProprio.amostra === 0 || anAdversario.amostra === 0) return null;
  const outlier = anProprio.outlierDetectado || anAdversario.outlierDetectado;
  const varianciaBaixa = anProprio.desvioRelativoMax <= 0.5 && anAdversario.desvioRelativoMax <= 0.5;
  const esperado = (anProprio.media + anAdversario.media) / 2;

  const candidatos = [];
  for (const linha of LINHAS_GOLS_TIME) {
    for (const direcao of ['mais de', 'menos de']) {
      const teste = direcao === 'mais de' ? (v) => v > linha : (v) => v < linha;
      const ladoProprio = contar(jogosTime, (j) => j.golsPro, teste);
      const ladoAdversario = contar(jogosAdversario, (j) => j.golsContra, teste);
      // Mantém a ordem mandante/visitante pra consistencia_mandante/visitante.
      const ladoA = timeEhMandante ? ladoProprio : ladoAdversario;
      const ladoB = timeEhMandante ? ladoAdversario : ladoProprio;
      candidatos.push({
        direcao, linha, ladoA, ladoB, outlier,
        distancia: Math.abs(linha - esperado),
        avaliacao: classificar({ ladoA, ladoB, outlier, varianciaBaixa, ehEscanteios: false }),
      });
    }
  }
  const melhor = escolherMelhor(candidatos);
  const nomeMandante = timeEhMandante ? nomeTime : nomeAdversario;
  const nomeVisitante = timeEhMandante ? nomeAdversario : nomeTime;
  const verbo = melhor.direcao === 'mais de' ? 'acima' : 'abaixo';
  const ladoProprio = timeEhMandante ? melhor.ladoA : melhor.ladoB;
  const ladoAdv = timeEhMandante ? melhor.ladoB : melhor.ladoA;

  const palpite = montarPalpite({
    mercado: `Gols de ${nomeTime}`,
    direcao: melhor.direcao,
    linha: melhor.linha,
    candidato: melhor,
    nomeMandante, nomeVisitante,
    textoA: '',
    textoB: '',
    meta: { tipo: 'gols_time', lado: timeEhMandante ? 'mandante' : 'visitante', linha: melhor.linha, direcao: melhor.direcao },
  });
  palpite.justificativa =
    `${nomeTime} (${timeEhMandante ? 'casa' : 'fora'}): ${anProprio.media} gols/jogo, ${ladoProprio.hit}/${ladoProprio.n} jogos ${verbo} de ${melhor.linha}. ` +
    `${nomeAdversario} (${timeEhMandante ? 'fora' : 'casa'}) sofre ${anAdversario.media} gols/jogo, ${ladoAdv.hit}/${ladoAdv.n} jogos ${verbo} de ${melhor.linha} sofridos.`;
  return palpite;
}

// Ambas marcam, jogo a jogo: quantos jogos de cada time tiveram gol dos dois.
function calcularAmbasMarcam({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }) {
  if (jogosMandante.length === 0 || jogosVisitante.length === 0) return null;
  const ambos = (j) => j.golsPro > 0 && j.golsContra > 0;
  const anA = analisarAmostra(jogosMandante.map((j) => j.golsPro));
  const anB = analisarAmostra(jogosVisitante.map((j) => j.golsPro));
  const varianciaBaixa = anA.desvioRelativoMax <= 0.5 && anB.desvioRelativoMax <= 0.5;

  const candidatos = ['sim', 'não'].map((direcao) => {
    const teste = direcao === 'sim' ? ambos : (j) => !ambos(j);
    const conta = (jogos) => ({ hit: jogos.filter(teste).length, n: jogos.length });
    const ladoA = conta(jogosMandante);
    const ladoB = conta(jogosVisitante);
    return { direcao, ladoA, ladoB, outlier: false, distancia: 0, avaliacao: classificar({ ladoA, ladoB, outlier: false, varianciaBaixa, ehEscanteios: false }) };
  });
  const melhor = escolherMelhor(candidatos);

  return montarPalpite({
    mercado: 'Ambas Equipes Marcam',
    direcao: melhor.direcao,
    linha: null,
    candidato: melhor,
    nomeMandante, nomeVisitante,
    textoA: `${melhor.ladoA.hit}/${melhor.ladoA.n} jogos ${melhor.direcao === 'sim' ? 'com gol dos dois lados' : 'em que pelo menos um lado não marcou'}`,
    textoB: `${melhor.ladoB.hit}/${melhor.ladoB.n} jogos ${melhor.direcao === 'sim' ? 'com gol dos dois lados' : 'em que pelo menos um lado não marcou'}`,
    meta: { tipo: 'ambas_marcam', direcao: melhor.direcao },
  });
}

// Handicap de escanteios: saldo de escanteios do favorito em cada jogo dele
// (o que fez menos o que o adversário fez) contra uma margem, e o inverso pro
// adversário (saldo negativo de pelo menos essa margem).
function calcularHandicapEscanteios({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }) {
  const saldo = (j) => (j.escanteios != null && j.escanteiosContra != null ? j.escanteios - j.escanteiosContra : null);
  const saldosA = jogosMandante.map(saldo).filter((v) => v != null);
  const saldosB = jogosVisitante.map(saldo).filter((v) => v != null);
  if (saldosA.length === 0 || saldosB.length === 0) return null;

  const anA = analisarAmostra(saldosA.map((v) => Math.abs(v)));
  const anB = analisarAmostra(saldosB.map((v) => Math.abs(v)));
  const mediaA = media(saldosA);
  const mediaB = media(saldosB);
  // Diferença esperada a favor do mandante: o que ele ganha em casa mais o que
  // o visitante perde fora, dividido por dois.
  const esperada = (mediaA - mediaB) / 2;
  const mandanteFavorito = esperada >= 0;
  const favorito = mandanteFavorito ? nomeMandante : nomeVisitante;
  const outlier = anA.outlierDetectado || anB.outlierDetectado;
  const varianciaBaixa = anA.desvioRelativoMax <= 0.5 && anB.desvioRelativoMax <= 0.5;

  const candidatos = LINHAS_HANDICAP_ESCANTEIOS.map((linha) => {
    const mandanteBate = (v) => v > linha; // saldo do mandante
    const visitanteBate = (v) => v < -linha; // saldo do visitante (negativo = adversário domina)
    const ladoA = contar(jogosMandante, saldo, mandanteFavorito ? mandanteBate : (v) => v < -linha);
    const ladoB = contar(jogosVisitante, saldo, mandanteFavorito ? visitanteBate : (v) => v > linha);
    return {
      linha, ladoA, ladoB, outlier,
      distancia: Math.abs(linha - Math.abs(esperada)),
      avaliacao: classificar({ ladoA, ladoB, outlier, varianciaBaixa, ehEscanteios: true }),
    };
  });
  const melhor = escolherMelhor(candidatos);

  return montarPalpite({
    mercado: 'Handicap de Escanteios',
    direcao: `${favorito} -${melhor.linha}`,
    linha: melhor.linha,
    candidato: melhor,
    nomeMandante, nomeVisitante,
    textoA: `saldo médio de ${arredondar(mediaA)} escanteios, ${melhor.ladoA.hit}/${melhor.ladoA.n} jogos com margem maior que ${melhor.linha} a favor de quem seria ${mandanteFavorito ? 'favorito' : 'adversário'}`,
    textoB: `saldo médio de ${arredondar(mediaB)} escanteios, ${melhor.ladoB.hit}/${melhor.ladoB.n} jogos coerentes com essa margem`,
    meta: { tipo: 'handicap_escanteios', favorito: mandanteFavorito ? 'mandante' : 'visitante', linha: melhor.linha },
    avisosExtras: ['Escanteios é o mercado mais volátil: só chega em forte com 7+ jogos de cada lado e variância baixa.'],
  });
}

// Resultado (vitória) e dupla chance. Forte só se houver gap real de tabela
// (> 5 posições ou > 10 pts) ou retrospecto de mando concordando com a tabela.
function calcularResultadoEDuplaChance({ jogosMandante, jogosVisitante, linhaMandante, linhaVisitante, nomeMandante, nomeVisitante }) {
  if (jogosMandante.length === 0 || jogosVisitante.length === 0) return [];

  const gapPosicoes = linhaMandante && linhaVisitante ? Math.abs(linhaMandante.posicao - linhaVisitante.posicao) : null;
  const gapPontos = linhaMandante && linhaVisitante ? Math.abs(linhaMandante.pontos - linhaVisitante.pontos) : null;
  const gapDeTabela = (gapPosicoes !== null && gapPosicoes > 5) || (gapPontos !== null && gapPontos > 10);
  const favoritoTabela = linhaMandante && linhaVisitante
    ? (linhaMandante.posicao < linhaVisitante.posicao ? 'mandante' : 'visitante')
    : null;

  const anA = analisarAmostra(jogosMandante.map((j) => j.golsPro));
  const anB = analisarAmostra(jogosVisitante.map((j) => j.golsPro));
  const varianciaBaixa = anA.desvioRelativoMax <= 0.5 && anB.desvioRelativoMax <= 0.5;

  const opcoes = [
    { grupo: 'resultado', direcao: `Vitória ${nomeMandante}`, lado: 'mandante', tipo: 'vitoria', testeA: (j) => j.resultado === 'V', testeB: (j) => j.resultado === 'D', txtA: 'vitórias em casa', txtB: 'derrotas fora' },
    { grupo: 'resultado', direcao: `Vitória ${nomeVisitante}`, lado: 'visitante', tipo: 'vitoria', testeA: (j) => j.resultado === 'D', testeB: (j) => j.resultado === 'V', txtA: 'derrotas em casa', txtB: 'vitórias fora' },
    { grupo: 'dupla', direcao: `${nomeMandante} ou empate`, lado: 'mandante', tipo: 'dupla', testeA: (j) => j.resultado !== 'D', testeB: (j) => j.resultado !== 'V', txtA: 'jogos sem derrota em casa', txtB: 'jogos sem vitória fora' },
    { grupo: 'dupla', direcao: `empate ou ${nomeVisitante}`, lado: 'visitante', tipo: 'dupla', testeA: (j) => j.resultado !== 'V', testeB: (j) => j.resultado !== 'D', txtA: 'jogos sem vitória em casa', txtB: 'jogos sem derrota fora' },
  ].map((op) => {
    const ladoA = { hit: jogosMandante.filter(op.testeA).length, n: jogosMandante.length };
    const ladoB = { hit: jogosVisitante.filter(op.testeB).length, n: jogosVisitante.length };
    const avaliacao = classificar({ ladoA, ladoB, outlier: false, varianciaBaixa, ehEscanteios: false });
    if (avaliacao.confianca === 'forte' && !gapDeTabela && favoritoTabela !== op.lado) {
      avaliacao.confianca = 'moderado-forte';
    }
    return { ...op, ladoA, ladoB, outlier: false, distancia: 0, avaliacao };
  });

  return ['resultado', 'dupla'].map((grupo) => {
    const melhor = escolherMelhor(opcoes.filter((o) => o.grupo === grupo));
    const nomeGrupo = grupo === 'resultado' ? 'Resultado Final' : 'Dupla Chance';
    const avisosExtras = gapDeTabela ? [`Gap de tabela: ${gapPosicoes} posições, ${gapPontos} pts.`] : [];
    return montarPalpite({
      mercado: nomeGrupo,
      direcao: melhor.direcao,
      linha: null,
      candidato: melhor,
      nomeMandante, nomeVisitante,
      textoA: `${melhor.ladoA.hit}/${melhor.ladoA.n} ${melhor.txtA}`,
      textoB: `${melhor.ladoB.hit}/${melhor.ladoB.n} ${melhor.txtB}`,
      meta: { tipo: melhor.tipo, lado: melhor.lado },
      avisosExtras,
    });
  });
}

// Jogo de pressão (os dois brigando contra o rebaixamento) reduz a confiança
// de "mais gols" em um nível.
function ajustarPorContexto(palpite, contextoMandante, contextoVisitante) {
  const ambosRebaixamento = contextoMandante === 'briga_rebaixamento' && contextoVisitante === 'briga_rebaixamento';
  const ehMuitosGols = palpite.meta?.tipo === 'total_gols' && palpite.direcao === 'mais de';
  if (!ambosRebaixamento || !ehMuitosGols) return palpite;
  return {
    ...palpite,
    confianca: rebaixar(palpite.confianca),
    avisos: [...palpite.avisos, 'Os dois times brigam contra o rebaixamento (jogo de pressão tem mais variância): confiança rebaixada.'],
  };
}

// Redundância (seção 6): mercados que se sobrepõem quase totalmente não
// podem ser empilhados - vitória e dupla chance do mesmo lado, "menos de N"
// gols e a faixa que termina perto de N, "ambas sim" e "mais de X gols" etc.
function saoRedundantes(a, b) {
  const [ma, mb] = [a.meta, b.meta];
  const par = (t1, t2) => (ma.tipo === t1 && mb.tipo === t2) || (ma.tipo === t2 && mb.tipo === t1);
  const escolher = (t) => (ma.tipo === t ? ma : mb);

  if (par('vitoria', 'dupla')) return ma.lado === mb.lado;
  if (par('total_gols', 'faixa_gols')) {
    const total = escolher('total_gols');
    const faixa = escolher('faixa_gols');
    return total.direcao === 'menos de'
      ? Math.abs(Math.floor(total.linha) - faixa.max) <= 1
      : Math.abs(Math.ceil(total.linha) - faixa.min) <= 1;
  }
  if (par('ambas_marcam', 'gols_time')) {
    return escolher('ambas_marcam').direcao === 'sim' && escolher('gols_time').direcao === 'mais de' && escolher('gols_time').linha <= 0.5;
  }
  if (par('ambas_marcam', 'total_gols')) {
    const total = escolher('total_gols');
    return escolher('ambas_marcam').direcao === 'sim' && total.direcao === 'mais de' && total.linha <= 1.5;
  }
  return false;
}

function marcarRedundancias(palpites) {
  palpites.forEach((p) => {
    p.redundante_com = palpites
      .filter((outro) => outro !== p && saoRedundantes(p, outro))
      .map((outro) => `${outro.mercado} (${outro.direcao}${outro.linha_sugerida != null && !outro.direcao.includes(String(outro.linha_sugerida)) ? ` ${outro.linha_sugerida}` : ''})`);
  });
}

// Combinação (seção 8): até 4 mercados moderado-forte ou melhores, sem
// redundância entre si, todos do MESMO jogo. Só devolve se houver 2+.
// A probabilidade combinada assume independência (produto) - é só uma
// referência; mercados do mesmo jogo tendem a se correlacionar.
function sugerirCombinacao(palpites) {
  const candidatos = palpites
    .filter((p) => (p.confianca === 'forte' || p.confianca === 'moderado-forte') && p.odd_justa >= 1.2)
    .sort((a, b) => NIVEIS.indexOf(b.confianca) - NIVEIS.indexOf(a.confianca) || b.probabilidade_estimada - a.probabilidade_estimada);

  const escolhidos = [];
  for (const p of candidatos) {
    if (escolhidos.length >= 4) break;
    if (escolhidos.some((e) => saoRedundantes(e, p))) continue;
    escolhidos.push(p);
  }
  if (escolhidos.length < 2) return null;

  const prob = escolhidos.reduce((acc, p) => acc * (p.probabilidade_estimada / 100), 1);
  return {
    mercados: escolhidos.map((p) => `${p.mercado}: ${p.direcao}${p.linha_sugerida != null && !p.direcao.includes(String(p.linha_sugerida)) ? ` ${p.linha_sugerida}` : ''}`),
    probabilidade_combinada_estimada: Math.round(prob * 100),
    odd_justa_combinada: prob > 0 ? arredondar(1 / prob) : null,
    aviso: 'Probabilidade combinada assume mercados independentes (produto simples); só vale a pena se a odd real da casa pagar mais que a odd justa.',
  };
}

function limparMeta(palpite) {
  const { meta, ...resto } = palpite;
  return resto;
}

function textoContexto(linha) {
  if (!linha) return null;
  return { posicao: linha.posicao, pontos: linha.pontos, faixa: linha.faixa_classificacao ?? null, contexto: contextoDoTime(linha) };
}

// Orquestração: busca o histórico (só do mando relevante) dos dois times e a
// tabela, roda todos os mercados e devolve o formato da seção 10. `palpites`
// traz só forte/moderado-forte/moderado (o que aparece na tela), ordenados do
// mais confiável; o que ficou em fraco vai em `palpites_descartados`.
export async function gerarPalpites(campeonatoId, timeMandanteId, timeVisitanteId, numeroRodada) {
  const [formaMandante, formaVisitante, tabela] = await Promise.all([
    buscarFormaTime(campeonatoId, timeMandanteId, numeroRodada, JOGOS_JANELA, true),
    buscarFormaTime(campeonatoId, timeVisitanteId, numeroRodada, JOGOS_JANELA, false),
    buscarTabela(campeonatoId).catch(() => null),
  ]);

  const linhaMandante = tabela?.find((l) => l.time.time_id === timeMandanteId) ?? null;
  const linhaVisitante = tabela?.find((l) => l.time.time_id === timeVisitanteId) ?? null;
  const nomeMandante = linhaMandante?.time?.nome_popular ?? `Time ${timeMandanteId}`;
  const nomeVisitante = linhaVisitante?.time?.nome_popular ?? `Time ${timeVisitanteId}`;

  const jogosMandante = formaMandante.jogos;
  const jogosVisitante = formaVisitante.jogos;

  const avisos = [];
  if (jogosMandante.length < AMOSTRA_MINIMA) {
    avisos.push(`Amostra insuficiente de jogos em casa pra ${nomeMandante} (${jogosMandante.length} jogo(s) encontrados).`);
  }
  if (jogosVisitante.length < AMOSTRA_MINIMA) {
    avisos.push(`Amostra insuficiente de jogos fora pra ${nomeVisitante} (${jogosVisitante.length} jogo(s) encontrados).`);
  }
  if (!linhaMandante || !linhaVisitante) avisos.push('Posição na tabela não confirmada pra um dos times.');
  avisos.push('Desfalques não confirmados - contexto de ausências não entra nessa análise (dado_incompleto).');
  avisos.push('Sem odds na fonte de dados: compare a odd real da casa com a `odd_justa` de cada palpite - só há valor se a odd da casa for maior.');

  const amostraInsuficiente = jogosMandante.length < AMOSTRA_MINIMA || jogosVisitante.length < AMOSTRA_MINIMA;
  let todos = [];
  let combinacao = null;

  if (!amostraInsuficiente) {
    const contextoMandante = contextoDoTime(linhaMandante);
    const contextoVisitante = contextoDoTime(linhaVisitante);
    const base = { jogosMandante, jogosVisitante, nomeMandante, nomeVisitante };

    todos = [
      ...Object.keys(ROTULOS).map((campo) => calcularMercadoTotal({ campo, ...base })),
      calcularFaixaGols(base),
      calcularAmbasMarcam(base),
      calcularGolsTime({ jogosTime: jogosMandante, jogosAdversario: jogosVisitante, nomeTime: nomeMandante, nomeAdversario: nomeVisitante, timeEhMandante: true }),
      calcularGolsTime({ jogosTime: jogosVisitante, jogosAdversario: jogosMandante, nomeTime: nomeVisitante, nomeAdversario: nomeMandante, timeEhMandante: false }),
      calcularHandicapEscanteios(base),
      ...calcularResultadoEDuplaChance({ ...base, linhaMandante, linhaVisitante }),
    ]
      .filter(Boolean)
      .map((p) => ajustarPorContexto(p, contextoMandante, contextoVisitante));

    const exibidos = todos.filter((p) => p.confianca !== 'fraco');
    marcarRedundancias(exibidos);
    combinacao = sugerirCombinacao(exibidos);
  } else {
    avisos.push('Amostra insuficiente pra classificar qualquer mercado - nenhum palpite gerado.');
  }

  const exibidos = todos
    .filter((p) => p.confianca !== 'fraco')
    .sort((a, b) => NIVEIS.indexOf(b.confianca) - NIVEIS.indexOf(a.confianca) || b.probabilidade_estimada - a.probabilidade_estimada);

  const resultado = {
    confronto: `${nomeMandante} x ${nomeVisitante}`,
    mando_confirmado: true,
    janela_jogos: { mandante_em_casa: jogosMandante.length, visitante_fora: jogosVisitante.length },
    contexto: { mandante: textoContexto(linhaMandante), visitante: textoContexto(linhaVisitante) },
    palpites: exibidos.map(limparMeta),
    combinacao_sugerida: combinacao,
    palpites_descartados: todos
      .filter((p) => p.confianca === 'fraco')
      .map((p) => `${p.mercado} (${p.direcao}${p.linha_sugerida != null && !p.direcao.includes(String(p.linha_sugerida)) ? ` ${p.linha_sugerida}` : ''})${p.contradicao_detectada ? ' - contradição' : ''}`),
    avisos,
  };

  // Auditoria (seção 12): guarda o que foi previsto pra jogos ainda não
  // disputados. Falha de gravação nunca deve derrubar a análise.
  try {
    const fixtures = await buscarTodasFixtures(campeonatoId);
    const fixture = fixtures.find(
      (f) => f.homeTeamId === timeMandanteId && f.awayTeamId === timeVisitanteId && Number(f.matchRound) === Number(numeroRodada),
    );
    if (fixture && fixture.matchStatus !== 'FINISHED') {
      registrarPalpites({ campeonatoId, fixtureId: fixture.id, confronto: resultado.confronto, palpites: exibidos });
    }
  } catch (err) {
    console.warn(`[auditoria] não registrou palpites: ${err.message}`);
  }

  return resultado;
}
