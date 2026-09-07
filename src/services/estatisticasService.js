// Mesmo modelo estatístico usado no comparativo pré-jogo do front-end
// (ver "Estimativa estatística" e "Chances" em public/script.js) - reimplementado
// aqui pro chat poder calcular os mesmos números de forma determinística,
// sem depender do modelo de linguagem pra fazer conta.

function fatorial(n) {
  let resultado = 1;
  for (let i = 2; i <= n; i++) resultado *= i;
  return resultado;
}

function poisson(lambda, k) {
  return (Math.exp(-lambda) * lambda ** k) / fatorial(k);
}

export function estimarProbabilidades(mediasMandante, mediasVisitante) {
  const xgMandante = (mediasMandante.mediaGolsPro + mediasVisitante.mediaGolsContra) / 2;
  const xgVisitante = (mediasVisitante.mediaGolsPro + mediasMandante.mediaGolsContra) / 2;

  let vitoriaMandante = 0;
  let empate = 0;
  let vitoriaVisitante = 0;

  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const probabilidade = poisson(xgMandante, i) * poisson(xgVisitante, j);
      if (i > j) vitoriaMandante += probabilidade;
      else if (i === j) empate += probabilidade;
      else vitoriaVisitante += probabilidade;
    }
  }

  const total = vitoriaMandante + empate + vitoriaVisitante;
  const valores = [
    Math.round((vitoriaMandante / total) * 100),
    Math.round((empate / total) * 100),
    Math.round((vitoriaVisitante / total) * 100),
  ];

  const diferenca = 100 - (valores[0] + valores[1] + valores[2]);
  valores[valores.indexOf(Math.max(...valores))] += diferenca;

  return {
    vitoriaMandante: valores[0],
    empate: valores[1],
    vitoriaVisitante: valores[2],
    xgMandante: Math.round(xgMandante * 10) / 10,
    xgVisitante: Math.round(xgVisitante * 10) / 10,
  };
}

export const ALERTA_CATEGORIAS = [
  ['Escanteios', 'escanteios', 'mediaEscanteios', ''],
  ['Chutes no gol', 'chutesNoGol', 'mediaChutesNoGol', ''],
  ['Finalizações', 'finalizacoes', 'mediaFinalizacoes', ''],
  ['Faltas cometidas', 'faltas', 'mediaFaltas', ''],
  ['Cartões amarelos', 'cartoesAmarelos', 'mediaCartoesAmarelos', ''],
  ['Impedimentos', 'impedimentos', 'mediaImpedimentos', ''],
  ['Gols marcados', 'golsPro', 'mediaGolsPro', ''],
  ['Gols sofridos', 'golsContra', 'mediaGolsContra', ''],
  ['Posse de bola', 'posseDeBola', 'mediaPosseDeBola', '%'],
];

export function calcularAlertas(jogos, medias) {
  return ALERTA_CATEGORIAS.map(([label, campo, campoMedia, sufixo]) => {
    const linha = Math.floor(medias[campoMedia]) + 0.5;
    const acima = jogos.filter((jogo) => jogo[campo] > linha).length;
    const percentual = Math.round((acima / jogos.length) * 100);
    return { label, linha, percentual, sufixo };
  });
}
