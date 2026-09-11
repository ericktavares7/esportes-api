// Ferramentas e execução compartilhadas entre os três provedores de IA do chat
// (Claude, ChatGPT, Gemini) - cada provedor tem seu próprio formato de "tool use",
// mas todos chamam exatamente essas mesmas duas ferramentas e recebem os mesmos
// dados de volta. Isso garante que a resposta final venha sempre dos mesmos
// números reais, calculados por código - o modelo só formata e explica.

import { getCampeonatos, getMinhaConta, getRodada, getTabela } from './apiFutebolService.js';
import { buscarFormaComMando } from './formaService.js';
import { estimarProbabilidades, calcularAlertas } from './estatisticasService.js';

const AMOSTRA_MINIMA_CONFIAVEL = 4;

// Mesma faixa de classificação que a tabela já usa no front-end - dá o "o
// que está em jogo" (briga por acesso, fuga de rebaixamento, ou nenhuma
// pressão direta) sem precisar de nenhuma fonte de dado nova.
const CONTEXTO_FAIXA = {
  rebaixados: 'na zona de rebaixamento',
  'rebaixados-serie-c': 'na zona de rebaixamento',
  'acesso-serie-a': 'brigando pelo acesso à Série A',
  'playoffs-de-acesso': 'brigando pelo playoff de acesso',
  libertadores: 'brigando por vaga na Libertadores',
  'pre-libertadores': 'brigando por vaga na Pré-Libertadores',
  'sul-americana': 'brigando por vaga na Sul-Americana',
};

function contextoTime(linhaTabela) {
  if (!linhaTabela) return null;
  const faixa = CONTEXTO_FAIXA[linhaTabela.faixa_classificacao] ?? 'sem pressão direta de acesso ou rebaixamento';
  return {
    posicao: linhaTabela.posicao,
    pontos: linhaTabela.pontos,
    descricao: `${linhaTabela.posicao}º colocado, ${linhaTabela.pontos} pts, ${faixa}`,
  };
}

export const SYSTEM_PROMPT = `Você é o assistente do Sport Analytics, um app pessoal (sem dinheiro
real, sem apostas de verdade) que o dono usa pra comparar times do Brasileirão Série B com o irmão dele.

Quando o usuário pedir "palpites" ou uma análise de confronto (ex: "manda pra mim palpites do jogo
Náutico x Botafogo-SP"):
1. Use a ferramenta buscar_jogos_rodada pra achar o jogo certo. O usuário pode escrever nomes parciais,
   apelidos, abreviações ou "AxB" - encontre o jogo mais parecido na lista retornada. Se o jogo não
   estiver na rodada atual, tente rodada_anterior ou proxima_rodada chamando de novo com "numero".
2. Use analisar_confronto com os IDs dos dois times encontrados pra pegar as estatísticas reais. Se o
   usuário não disser quantos jogos analisar, não pergunte - deixe o campo "quantidade" de fora, o
   próprio sistema já usa a quantidade padrão configurada pelo usuário nas configurações do chat. Só
   pergunte por um número diferente se o usuário mencionar explicitamente "últimos 5/10/15 jogos" ou
   pedir pra mudar no meio da conversa.
3. Monte a ficha de análise seguindo o roteiro abaixo.

Se a mensagem do usuário já vier com um bloco chamado "DADOS PRÉ-CALCULADOS": esses dados já foram
calculados a partir do(s) jogo(s) que o usuário escolheu na tela - NÃO chame buscar_jogos_rodada nem
analisar_confronto de novo, só monte a ficha com esses números seguindo o mesmo roteiro. Se vier mais
de um jogo (pensando numa "múltipla"), monte uma ficha curta pra cada jogo separadamente - não invente
uma probabilidade combinada da múltipla inteira, cada jogo é independente e o usuário decide como
combinar.

## Roteiro da ficha

**1. Contexto** - uma linha por time, usando \`mandante.contexto.descricao\` / \`visitante.contexto.descricao\`
(posição, pontos, e se está brigando por acesso, fugindo do rebaixamento, ou sem pressão direta - isso
já vem pronto, não precisa calcular). Depois disso, deixe explícito em UMA frase que você não tem acesso
a desfalques confirmados (lesão/suspensão), rivalidade/clássico, nem situação do técnico/torcida -
**nunca invente ou "sinta" isso a partir do nome dos times**, mesmo que pareça um confronto conhecido.
Não trave a resposta esperando o usuário responder essa lacuna - é uma limitação estrutural da fonte de
dados, não algo que o usuário consiga preencher; só declare com transparência e siga com o que os
números permitem.

**2. Forma recente separada por mando de campo** - o mandante já vem com o histórico específico de jogos
EM CASA, e o visitante com o histórico específico de jogos FORA (campo \`medias\` de cada lado). Se
\`mandoEspecifico\` vier \`false\` em algum time, avise em uma linha que não havia jogos suficientes nesse
recorte e a estimativa caiu pro histórico geral (casa + fora misturado) - isso enfraquece a confiança
do palpite pra aquele time. Se \`amostraPequena\` vier \`true\` (menos de 4 jogos analisados), avise que a
amostra é pequena.

**3. Sequência recente** - as "chances" (\`mandante.chances\`/\`visitante.chances\`) já são a frequência real
jogo a jogo (quantos dos últimos jogos passaram de uma linha), não uma média solta - pode citar como
"bateu X% dos últimos jogos", não precisa listar todas as 9 categorias, escolha as mais relevantes pro
jogo.

**4. Classifique cada sugestão que der** (resultado, ambas marcam, mais/menos de 2.5 gols, ou uma
"chance" específica) como:
- **Forte**: os dois times apontam na mesma direção (ex: os dois têm chance alta de "mais de 2.5 gols"
  separadamente), nenhum dos dois está com amostra pequena ou mandoEspecifico false, e o percentual é
  alto (65%+).
- **Moderado**: sinal existe mas com ressalva - só um lado aponta nessa direção, ou amostra pequena/
  mando geral em vez de específico, ou percentual mais baixo (55-65%).
- Abaixo de 55%, ou dado contraditório entre os dois times: não vale a pena listar como sugestão -
  omita em vez de forçar um palpite fraco.
Nunca chame nada de "Forte" só porque um número isolado é alto - cruze os dois lados primeiro.

**5. Formato**: ficha direta, tipo casa de aposta - percentual de vitória/empate/derrota, ambas marcam
e mais de 2.5 gols (\`probabilidade.ambasMarcam\`/\`maisDe25Gols\`), as chances mais relevantes com a
classificação Forte/Moderado. Sem redação, sem repetir aviso jurídico a cada mensagem.

Regras importantes:
- Nunca invente número. Todo percentual e média vêm exatamente dos dados que as ferramentas (ou o
  bloco de dados pré-calculados) retornarem - se um dado não veio de lá, não afirme.
- São estimativas a partir de um histórico curto, não garantia de resultado - deixe isso implícito
  no tom, sem repetir um aviso jurídico toda hora.
- Se não achar o jogo, ou um dos times não tiver jogos suficientes no histórico, diga isso direto em
  vez de inventar números.
- Se um time vier com "incompleto: true" (jogosAnalisados menor que jogosTentados): a cota da API
  acabou no meio da busca do histórico, então a estimativa usou menos jogos do que o normal. Avise
  isso rapidamente (ex: "baseado em 6 dos 10 jogos - cota da API acabou no meio da busca") em vez de
  tratar como se fosse o padrão normal, mas sem dramatizar - é só um aviso de uma linha.
- Seja direto e objetivo. Formato de ficha, não redação.`;

// Formato neutro (JSON Schema puro) - cada provedor adapta pro seu próprio
// formato de declaração de tool na hora de montar a chamada.
export const TOOL_DEFS = [
  {
    name: 'buscar_jogos_rodada',
    description:
      'Lista os jogos de uma rodada do Brasileirão Série B (times, IDs, placar/status). Use pra ' +
      'descobrir o ID dos times e o número da rodada a partir do que o usuário escreveu.',
    parameters: {
      type: 'object',
      properties: {
        numero: {
          type: 'integer',
          description: 'Número da rodada. Se não informado, usa a rodada atual do campeonato.',
        },
      },
      required: [],
    },
  },
  {
    name: 'analisar_confronto',
    description:
      'Calcula a estimativa de probabilidade (vitória/empate/derrota, ambas marcam, mais de 2.5 gols) e ' +
      'as chances (over/under) de escanteios, cartões, gols etc. dos dois times, a partir do histórico ' +
      'real de cada um antes da rodada informada - já separado por mando de campo (mandante usa só ' +
      'jogos em casa, visitante só jogos fora, com fallback pro geral se não houver amostra suficiente) ' +
      'e já com o contexto de tabela (posição, pontos, se está brigando por acesso/rebaixamento) de ' +
      'cada time.',
    parameters: {
      type: 'object',
      properties: {
        timeMandanteId: { type: 'integer' },
        timeVisitanteId: { type: 'integer' },
        numeroRodada: {
          type: 'integer',
          description: 'Rodada em que o confronto acontece - o histórico busca só jogos ANTERIORES a ela.',
        },
        quantidade: {
          type: 'integer',
          description: 'Quantos jogos recentes de cada time analisar. Deixe de fora pra usar o padrão do usuário.',
        },
      },
      required: ['timeMandanteId', 'timeVisitanteId', 'numeroRodada'],
    },
  },
];

async function resolverCampeonatoId() {
  const campeonatos = await getCampeonatos();
  let liberados = campeonatos;
  try {
    const minhaConta = await getMinhaConta();
    const idsLiberados = new Set(minhaConta.campeonatos.map((c) => c.campeonato_id));
    liberados = campeonatos.filter((c) => idsLiberados.has(c.campeonato_id));
  } catch {
    // /me falhou - segue com o catálogo completo em vez de travar a busca do jogo
  }
  const serieB = liberados.find((c) => c.nome?.includes('Série B'));
  return (serieB ?? liberados[0])?.campeonato_id;
}

async function buscarJogosRodada(input) {
  const campeonatoId = await resolverCampeonatoId();
  if (!campeonatoId) return { erro: 'Nenhum campeonato disponível no plano atual.' };

  let numero = input.numero;
  if (!numero) {
    const campeonatos = await getCampeonatos();
    const atual = campeonatos.find((c) => c.campeonato_id === campeonatoId);
    numero = atual?.rodada_atual?.rodada;
  }
  if (!numero) return { erro: 'Não encontrei a rodada atual (o campeonato pode ser de mata-mata).' };

  const rodada = await getRodada(campeonatoId, numero);
  return {
    campeonatoId,
    numero: rodada.rodada,
    nome: rodada.nome,
    rodadaAnterior: rodada.rodada_anterior,
    proximaRodada: rodada.proxima_rodada,
    partidas: (rodada.partidas ?? []).map((p) => ({
      partidaId: p.partida_id,
      status: p.status,
      data: p.data_realizacao,
      mandante: { id: p.time_mandante.time_id, nome: p.time_mandante.nome_popular },
      visitante: { id: p.time_visitante.time_id, nome: p.time_visitante.nome_popular },
      placar: p.status === 'finalizado' ? `${p.placar_mandante} x ${p.placar_visitante}` : null,
    })),
  };
}

function montarResultadoConfronto(formaMandante, formaVisitante, contextoMandante, contextoVisitante) {
  if (!formaMandante.medias || !formaVisitante.medias) {
    return { erro: 'Não há jogos suficientes no histórico de um dos dois times.' };
  }

  // jogosTentados só existe quando a forma veio de buscarFormaTime (não da
  // seleção manual por ID) - se a cota acabou no meio da busca de detalhes,
  // jogosObtidos fica menor que jogosTentados em vez de derrubar tudo.
  const incompleto =
    (formaMandante.jogosTentados ?? formaMandante.medias.jogosAnalisados) > formaMandante.medias.jogosAnalisados ||
    (formaVisitante.jogosTentados ?? formaVisitante.medias.jogosAnalisados) > formaVisitante.medias.jogosAnalisados;

  return {
    mandante: {
      jogosAnalisados: formaMandante.medias.jogosAnalisados,
      jogosTentados: formaMandante.jogosTentados ?? formaMandante.medias.jogosAnalisados,
      amostraPequena: formaMandante.medias.jogosAnalisados < AMOSTRA_MINIMA_CONFIAVEL,
      mandoEspecifico: formaMandante.mandoEspecifico ?? null,
      contexto: contextoMandante,
      medias: formaMandante.medias,
      chances: calcularAlertas(formaMandante.jogos, formaMandante.medias),
    },
    visitante: {
      jogosAnalisados: formaVisitante.medias.jogosAnalisados,
      jogosTentados: formaVisitante.jogosTentados ?? formaVisitante.medias.jogosAnalisados,
      amostraPequena: formaVisitante.medias.jogosAnalisados < AMOSTRA_MINIMA_CONFIAVEL,
      mandoEspecifico: formaVisitante.mandoEspecifico ?? null,
      contexto: contextoVisitante,
      medias: formaVisitante.medias,
      chances: calcularAlertas(formaVisitante.jogos, formaVisitante.medias),
    },
    probabilidade: estimarProbabilidades(formaMandante.medias, formaVisitante.medias),
    incompleto,
  };
}

export async function analisarConfronto(input, contexto) {
  const campeonatoId = await resolverCampeonatoId();
  const quantidade = input.quantidade ?? contexto?.quantidadePadrao ?? 10;

  const [formaMandante, formaVisitante, tabela] = await Promise.all([
    buscarFormaComMando(campeonatoId, input.timeMandanteId, input.numeroRodada, quantidade, true),
    buscarFormaComMando(campeonatoId, input.timeVisitanteId, input.numeroRodada, quantidade, false),
    getTabela(campeonatoId).catch(() => null),
  ]);

  const linhaMandante = tabela?.find((l) => l.time.time_id === input.timeMandanteId);
  const linhaVisitante = tabela?.find((l) => l.time.time_id === input.timeVisitanteId);

  return montarResultadoConfronto(formaMandante, formaVisitante, contextoTime(linhaMandante), contextoTime(linhaVisitante));
}

export async function executarFerramenta(nome, input, contexto) {
  if (nome === 'buscar_jogos_rodada') return buscarJogosRodada(input);
  if (nome === 'analisar_confronto') return analisarConfronto(input, contexto);
  return { erro: `Ferramenta desconhecida: ${nome}` };
}

export const MAX_VOLTAS = 6;
