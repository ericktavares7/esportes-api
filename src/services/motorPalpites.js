// Motor de análise de palpites (casa/fora + últimos 5-7 jogos) - implementa a
// especificação combinada com o usuário. Módulo separado do resto do app de
// propósito: ainda não está ligado à tela principal, só pronto pra testar
// contra jogos reais antes de decidir se substitui/complementa o sistema de
// "Palpites fortes" que já existe (baseado em Poisson) em public/script.js.
//
// Pontos da spec que exigiram uma escolha de interpretação (documentados
// onde aparecem no código, pra revisão):
// - "outlier > média + 1.5x o desvio dos outros valores" foi implementado
//   como desvio padrão da amostra completa (não leave-one-out).
// - "variância baixa" = nenhum jogo individual passa de 50% de distância da
//   própria média do time; "alta variância" = algum jogo passa de 100%.
// - "convergem na mesma direção" pros mercados de total (gols/escanteios/
//   cartões) é medido pela distribuição real jogo a jogo (ver
//   calcularMercadoTotal) batendo com o lado indicado pela soma das médias,
//   não só a soma isolada.
// - outlier detectado nunca deixa classificar como "forte", mesmo com
//   amostra e variância boas - cai pra "moderado" (a tabela da spec cita
//   outlier como "ressalva" do nível moderado).

import { buscarFormaTime } from './formaService.js';
import { buscarTabela } from './goalApiService.js';

const JOGOS_JANELA = 7; // "os 5 a 7 jogos mais recentes" - pede o teto, usa o que vier
const AMOSTRA_FRACA = 3; // < 3 de qualquer lado => fraco / não recomendar
const AMOSTRA_MODERADA = 4; // >= 4 de pelo menos um lado => pode virar moderado
const AMOSTRA_FORTE = 5; // >= 5 dos dois lados => pode virar forte

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

// Seção 3: média + detecção de outlier. Só troca a média principal pela
// versão sem outlier se a diferença entre as duas passar de 30% - caso
// contrário o outlier fica, mas nada muda no resultado.
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

  if (semOutliers.length === valores.length || semOutliers.length === 0) {
    return { media: arredondar(mediaCompleta), mediaComOutlier: arredondar(mediaCompleta), outlierDetectado: false, amostra: valores.length, desvioRelativoMax };
  }

  const mediaSemOutlier = media(semOutliers);
  const diferencaPct = mediaCompleta === 0 ? 0 : Math.abs(mediaCompleta - mediaSemOutlier) / mediaCompleta;

  if (diferencaPct > 0.3) {
    return { media: arredondar(mediaSemOutlier), mediaComOutlier: arredondar(mediaCompleta), outlierDetectado: true, amostra: valores.length, desvioRelativoMax };
  }
  return { media: arredondar(mediaCompleta), mediaComOutlier: arredondar(mediaCompleta), outlierDetectado: false, amostra: valores.length, desvioRelativoMax };
}

// Seção 5: tabela de decisão de confiança. "Alta variância"/"dados
// contraditórios" da spec já ficam cobertos por `direcaoConvergente` (cada
// função de mercado decide o que conta como contraditório pro caso dela) -
// não existe um segundo corte automático por desvio aqui, só o requisito de
// variância BAIXA pra chegar em "forte".
function classificarConfianca({ amostraMandante, amostraVisitante, direcaoConvergente, desvioRelativoMaxMandante, desvioRelativoMaxVisitante, outlierDetectado }) {
  const menorAmostra = Math.min(amostraMandante, amostraVisitante);
  const maiorAmostra = Math.max(amostraMandante, amostraVisitante);

  if (menorAmostra < AMOSTRA_FRACA || !direcaoConvergente) {
    return 'fraco';
  }

  const varianciaBaixa = desvioRelativoMaxMandante <= 0.5 && desvioRelativoMaxVisitante <= 0.5;
  const amostraForteDosDoisLados = amostraMandante >= AMOSTRA_FORTE && amostraVisitante >= AMOSTRA_FORTE;

  if (amostraForteDosDoisLados && varianciaBaixa && !outlierDetectado) {
    return 'forte';
  }

  if (maiorAmostra >= AMOSTRA_MODERADA) {
    return 'moderado';
  }

  return 'fraco';
}

// Seção 4 + parte da 8: mercados de "total" (gols, escanteios, cartões
// amarelos). total_esperado soma a média de cada lado (mandante em casa +
// visitante fora); a distribuição real cruza o total de CADA jogo já
// disputado por cada time (o que ele fez + o que o adversário dele fez
// naquela partida específica) contra a linha candidata - mais preciso que só
// somar duas médias isoladas, como pede a spec.
function calcularMercadoTotal({ label, jogosMandante, jogosVisitante, campoFavor, campoContra, nomeMandante, nomeVisitante }) {
  // Jogos sem a estatística (null: a fonte não trouxe) ficam de fora - a
  // amostra que o motor enxerga é só a dos jogos com dado de verdade.
  jogosMandante = jogosMandante.filter((j) => j[campoFavor] != null);
  jogosVisitante = jogosVisitante.filter((j) => j[campoFavor] != null);
  const valoresMandante = jogosMandante.map((j) => j[campoFavor]);
  const valoresVisitante = jogosVisitante.map((j) => j[campoFavor]);

  const anMandante = analisarAmostra(valoresMandante);
  const anVisitante = analisarAmostra(valoresVisitante);
  if (anMandante.amostra === 0 || anVisitante.amostra === 0) return null;

  const totalEsperado = anMandante.media + anVisitante.media;
  const linha = Math.floor(totalEsperado) + 0.5;

  const totaisReais = [
    ...jogosMandante.map((j) => j[campoFavor] + (j[campoContra] ?? 0)),
    ...jogosVisitante.map((j) => j[campoFavor] + (j[campoContra] ?? 0)),
  ];
  const direcao = totalEsperado >= linha ? 'mais de' : 'menos de';
  const acimaDaLinha = totaisReais.filter((v) => v > linha).length;
  const pctNaDirecao = totaisReais.length > 0
    ? (direcao === 'mais de' ? acimaDaLinha : totaisReais.length - acimaDaLinha) / totaisReais.length
    : 0;

  // "Convergem na mesma direção" de verdade combina dois sinais, não só um:
  // 1) cada time, isoladamente, precisa contribuir mais que a "metade que
  //    cabia a ele" na linha - se um empurra pra cima e o outro pra baixo, é
  //    sinal contraditório, mesmo que a soma bata na conta;
  // 2) a distribuição real (jogo a jogo) também precisa apoiar minimamente
  //    essa direção (>=55%) - sem isso, dava pra classificar como
  //    moderado/forte um mercado cuja própria evidência no texto mostrasse
  //    perto de 50/50, o que fica contraditório pra quem lê o resultado.
  const metadeLinha = linha / 2;
  const mandanteApoiaMais = anMandante.media > metadeLinha;
  const visitanteApoiaMais = anVisitante.media > metadeLinha;
  const timesConvergem = mandanteApoiaMais === visitanteApoiaMais;
  const direcaoConvergente = timesConvergem && pctNaDirecao >= 0.55;

  const confianca = classificarConfianca({
    amostraMandante: anMandante.amostra,
    amostraVisitante: anVisitante.amostra,
    direcaoConvergente,
    desvioRelativoMaxMandante: anMandante.desvioRelativoMax,
    desvioRelativoMaxVisitante: anVisitante.desvioRelativoMax,
    outlierDetectado: anMandante.outlierDetectado || anVisitante.outlierDetectado,
  });

  return {
    mercado: label,
    linha_sugerida: linha,
    direcao,
    confianca,
    justificativa:
      `${nomeMandante} casa: ${anMandante.media}/jogo (${anMandante.amostra} jogos). ` +
      `${nomeVisitante} fora: ${anVisitante.media}/jogo (${anVisitante.amostra} jogos). ` +
      `${direcao === 'mais de' ? acimaDaLinha : totaisReais.length - acimaDaLinha}/${totaisReais.length} jogos recentes combinados ficaram ` +
      `${direcao === 'mais de' ? 'acima' : 'abaixo'} de ${linha} (${Math.round(pctNaDirecao * 100)}%).`,
    amostra_time_a: anMandante.amostra,
    amostra_time_b: anVisitante.amostra,
    outlier_detectado: anMandante.outlierDetectado || anVisitante.outlierDetectado,
  };
}

// Seção 8.3: ambas marcam. Aproximação simples (P(A marca) x P(B marca)) -
// não é um modelo de Poisson completo, só a frequência histórica direta.
function calcularAmbasMarcam({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }) {
  if (jogosMandante.length === 0 || jogosVisitante.length === 0) return null;

  const marcouMandante = jogosMandante.filter((j) => j.golsPro > 0).length;
  const marcouVisitante = jogosVisitante.filter((j) => j.golsPro > 0).length;
  const pctMandanteMarca = marcouMandante / jogosMandante.length;
  const pctVisitanteMarca = marcouVisitante / jogosVisitante.length;

  const estimativaSim = pctMandanteMarca * pctVisitanteMarca;
  const direcao = estimativaSim >= 0.5 ? 'sim' : 'não';
  const direcaoConvergente = (pctMandanteMarca >= 0.5) === (pctVisitanteMarca >= 0.5);

  const anMandante = analisarAmostra(jogosMandante.map((j) => j.golsPro));
  const anVisitante = analisarAmostra(jogosVisitante.map((j) => j.golsPro));

  const confianca = classificarConfianca({
    amostraMandante: jogosMandante.length,
    amostraVisitante: jogosVisitante.length,
    direcaoConvergente,
    desvioRelativoMaxMandante: anMandante.desvioRelativoMax,
    desvioRelativoMaxVisitante: anVisitante.desvioRelativoMax,
    outlierDetectado: false,
  });

  return {
    mercado: 'Ambas Equipes Marcam',
    linha_sugerida: null,
    direcao,
    confianca,
    justificativa:
      `${nomeMandante} marcou em ${marcouMandante}/${jogosMandante.length} jogos em casa. ` +
      `${nomeVisitante} marcou em ${marcouVisitante}/${jogosVisitante.length} jogos fora.`,
    amostra_time_a: jogosMandante.length,
    amostra_time_b: jogosVisitante.length,
    outlier_detectado: false,
  };
}

// Seção 8.5: handicap de escanteios. Não dá pra cruzar jogo a jogo de
// verdade (mandante e visitante jogaram contra adversários diferentes no
// passado), então usa o produto cartesiano dos dois recortes como proxy da
// variação real da vantagem - e aplica a margem de segurança de 1.5 quando a
// diferença esperada é pequena, como pede a spec.
function calcularHandicapEscanteios({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }) {
  // Jogos sem escanteios (null: a fonte não trouxe) ficam de fora.
  jogosMandante = jogosMandante.filter((j) => j.escanteios != null);
  jogosVisitante = jogosVisitante.filter((j) => j.escanteios != null);
  const anMandante = analisarAmostra(jogosMandante.map((j) => j.escanteios));
  const anVisitante = analisarAmostra(jogosVisitante.map((j) => j.escanteios));
  if (anMandante.amostra === 0 || anVisitante.amostra === 0) return null;

  const diferencaEsperada = anMandante.media - anVisitante.media;
  const favorito = diferencaEsperada >= 0 ? nomeMandante : nomeVisitante;
  const diferencaAbs = Math.abs(diferencaEsperada);

  const diferencasIndividuais = [];
  jogosMandante.forEach((jm) => {
    jogosVisitante.forEach((jv) => {
      diferencasIndividuais.push(jm.escanteios - jv.escanteios);
    });
  });
  const mesmoLado = diferencasIndividuais.filter((d) => (diferencaEsperada >= 0 ? d > 0 : d < 0)).length;
  const pctMesmoLado = diferencasIndividuais.length > 0 ? mesmoLado / diferencasIndividuais.length : 0;
  const direcaoConvergente = pctMesmoLado >= 0.6;

  const margem = diferencaAbs < 2 ? 1.5 : 0.5;
  const linha = arredondar(Math.max(diferencaAbs - margem, 0.5));

  const confianca = classificarConfianca({
    amostraMandante: anMandante.amostra,
    amostraVisitante: anVisitante.amostra,
    direcaoConvergente,
    desvioRelativoMaxMandante: anMandante.desvioRelativoMax,
    desvioRelativoMaxVisitante: anVisitante.desvioRelativoMax,
    outlierDetectado: anMandante.outlierDetectado || anVisitante.outlierDetectado,
  });

  return {
    mercado: 'Handicap de Escanteios',
    linha_sugerida: linha,
    direcao: `${favorito} -${linha}`,
    confianca,
    justificativa:
      `${nomeMandante}: ${anMandante.media} escanteios/jogo em casa (${anMandante.amostra} jogos). ` +
      `${nomeVisitante}: ${anVisitante.media} escanteios/jogo fora (${anVisitante.amostra} jogos). ` +
      `Diferença esperada: ${arredondar(diferencaAbs)} a favor de ${favorito} (margem de segurança já aplicada na linha).`,
    amostra_time_a: anMandante.amostra,
    amostra_time_b: anVisitante.amostra,
    outlier_detectado: anMandante.outlierDetectado || anVisitante.outlierDetectado,
  };
}

// Seção 8.6: dupla chance. Só marca "forte" com gap real de tabela (>5
// posições ou >10 pts) OU quando o retrospecto de mando dos dois lados
// concorda com quem a tabela aponta como favorito - senão fica em moderado
// mesmo com amostra boa.
function calcularDuplaChance({ jogosMandante, jogosVisitante, linhaMandante, linhaVisitante, nomeMandante, nomeVisitante }) {
  if (jogosMandante.length === 0 || jogosVisitante.length === 0) return null;

  const aproveitamentoMandante = jogosMandante.filter((j) => j.resultado !== 'D').length / jogosMandante.length;
  const aproveitamentoVisitante = jogosVisitante.filter((j) => j.resultado !== 'D').length / jogosVisitante.length;

  const gapPosicoes = linhaMandante && linhaVisitante ? Math.abs(linhaMandante.posicao - linhaVisitante.posicao) : null;
  const gapPontos = linhaMandante && linhaVisitante ? Math.abs(linhaMandante.pontos - linhaVisitante.pontos) : null;
  const gapDeTabela = (gapPosicoes !== null && gapPosicoes > 5) || (gapPontos !== null && gapPontos > 10);

  const favoritoTabela = linhaMandante && linhaVisitante
    ? (linhaMandante.posicao < linhaVisitante.posicao ? 'mandante' : 'visitante')
    : null;
  const retrospectoConcorda =
    (aproveitamentoMandante > aproveitamentoVisitante && favoritoTabela === 'mandante') ||
    (aproveitamentoVisitante > aproveitamentoMandante && favoritoTabela === 'visitante');

  const lado = aproveitamentoMandante >= aproveitamentoVisitante ? 'mandante' : 'visitante';
  const direcao = lado === 'mandante' ? `${nomeMandante} ou empate` : `empate ou ${nomeVisitante}`;
  // Convergência geral (pra moderado/fraco) é só uma diferença perceptível de
  // aproveitamento entre os dois lados - o gap de tabela/retrospecto batendo
  // com a tabela é um requisito À PARTE, só pra chegar em "forte" (ver abaixo).
  const direcaoConvergente = Math.abs(aproveitamentoMandante - aproveitamentoVisitante) >= 0.15;

  const anMandante = analisarAmostra(jogosMandante.map((j) => j.golsPro));
  const anVisitante = analisarAmostra(jogosVisitante.map((j) => j.golsPro));

  let confianca = classificarConfianca({
    amostraMandante: jogosMandante.length,
    amostraVisitante: jogosVisitante.length,
    direcaoConvergente,
    desvioRelativoMaxMandante: anMandante.desvioRelativoMax,
    desvioRelativoMaxVisitante: anVisitante.desvioRelativoMax,
    outlierDetectado: false,
  });
  // Regra explícita da spec: mesmo com tudo "forte" pelos critérios gerais,
  // só mantém forte se realmente houver gap de tabela ou retrospecto batendo.
  if (confianca === 'forte' && !gapDeTabela && !retrospectoConcorda) confianca = 'moderado';

  return {
    mercado: 'Dupla Chance',
    linha_sugerida: null,
    direcao,
    confianca,
    justificativa:
      `${nomeMandante}: ${Math.round(aproveitamentoMandante * 100)}% de jogos sem derrota em casa (${jogosMandante.length}). ` +
      `${nomeVisitante}: ${Math.round(aproveitamentoVisitante * 100)}% fora (${jogosVisitante.length}).` +
      (gapDeTabela ? ` Gap de tabela: ${gapPosicoes} posições, ${gapPontos} pts.` : ' Sem gap relevante de tabela.'),
    amostra_time_a: jogosMandante.length,
    amostra_time_b: jogosVisitante.length,
    outlier_detectado: false,
  };
}

// Seção 6: jogo de pressão (os dois brigando contra o rebaixamento) reduz a
// confiança de "mais gols" em um nível - não vira "menos gols" automático,
// só menos confiança no "mais".
function ajustarPorContexto(palpite, contextoMandante, contextoVisitante) {
  if (!palpite) return palpite;
  const ambosRebaixamento = contextoMandante === 'briga_rebaixamento' && contextoVisitante === 'briga_rebaixamento';
  const ehMuitosGols = palpite.mercado === 'Total de Gols' && palpite.direcao === 'mais de';
  if (!ambosRebaixamento || !ehMuitosGols) return palpite;

  const rebaixar = { forte: 'moderado', moderado: 'fraco', fraco: 'fraco' };
  return {
    ...palpite,
    confianca: rebaixar[palpite.confianca],
    justificativa: `${palpite.justificativa} Confiança reduzida: os dois times brigam contra o rebaixamento (jogo de pressão tende a ter mais variância).`,
  };
}

// Orquestração: busca o histórico (só do mando relevante) dos dois times e a
// tabela, roda os cálculos e devolve o formato da seção 7. Ainda não filtra
// por confiança na saída principal - devolve `palpites` (forte/moderado, o
// que deve aparecer na tela) e `palpites_descartados` (fraco, só os nomes,
// pra quem for validar manualmente conseguir ver o que foi calculado mas
// ficou de fora e conferir se concorda com o corte).
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
  if (jogosMandante.length < AMOSTRA_FRACA) {
    avisos.push(`Amostra insuficiente de jogos em casa pra ${nomeMandante} (${jogosMandante.length} jogo(s) encontrados).`);
  }
  if (jogosVisitante.length < AMOSTRA_FRACA) {
    avisos.push(`Amostra insuficiente de jogos fora pra ${nomeVisitante} (${jogosVisitante.length} jogo(s) encontrados).`);
  }
  if (!linhaMandante || !linhaVisitante) avisos.push('Posição na tabela não confirmada pra um dos times.');
  avisos.push('Desfalques não confirmados - contexto de ausências não entra nessa análise (dado_incompleto).');

  const amostraInsuficiente = jogosMandante.length < AMOSTRA_FRACA || jogosVisitante.length < AMOSTRA_FRACA;

  let todos = [];
  if (!amostraInsuficiente) {
    const contextoMandante = contextoDoTime(linhaMandante);
    const contextoVisitante = contextoDoTime(linhaVisitante);

    todos = [
      calcularMercadoTotal({ label: 'Total de Gols', jogosMandante, jogosVisitante, campoFavor: 'golsPro', campoContra: 'golsContra', nomeMandante, nomeVisitante }),
      calcularMercadoTotal({ label: 'Total de Escanteios', jogosMandante, jogosVisitante, campoFavor: 'escanteios', campoContra: 'escanteiosContra', nomeMandante, nomeVisitante }),
      calcularAmbasMarcam({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }),
      calcularMercadoTotal({ label: 'Total de Cartões Amarelos', jogosMandante, jogosVisitante, campoFavor: 'cartoesAmarelos', campoContra: 'cartoesAmarelosContra', nomeMandante, nomeVisitante }),
      calcularHandicapEscanteios({ jogosMandante, jogosVisitante, nomeMandante, nomeVisitante }),
      calcularDuplaChance({ jogosMandante, jogosVisitante, linhaMandante, linhaVisitante, nomeMandante, nomeVisitante }),
    ]
      .filter(Boolean)
      .map((p) => ajustarPorContexto(p, contextoMandante, contextoVisitante));
  } else {
    avisos.push('Amostra insuficiente pra classificar qualquer mercado - nenhum palpite gerado.');
  }

  return {
    confronto: `${nomeMandante} x ${nomeVisitante}`,
    palpites: todos.filter((p) => p.confianca === 'forte' || p.confianca === 'moderado'),
    palpites_descartados: todos.filter((p) => p.confianca === 'fraco').map((p) => `${p.mercado} (${p.direcao})`),
    avisos,
  };
}
