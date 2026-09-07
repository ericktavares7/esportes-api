// Ferramentas e execução compartilhadas entre os três provedores de IA do chat
// (Claude, ChatGPT, Gemini) - cada provedor tem seu próprio formato de "tool use",
// mas todos chamam exatamente essas mesmas duas ferramentas e recebem os mesmos
// dados de volta. Isso garante que a resposta final venha sempre dos mesmos
// números reais, calculados por código - o modelo só formata e explica.

import { getCampeonatos, getMinhaConta, getRodada } from './apiFutebolService.js';
import { buscarFormaTime, buscarJogosPorId } from './formaService.js';
import { estimarProbabilidades, calcularAlertas } from './estatisticasService.js';
import { estaCache, usoApiHoje } from '../db/cache.js';
import { LIMITE_DIARIO_API } from '../config/limites.js';

export const SYSTEM_PROMPT = `Você é o assistente do Esportes Analytics, um app pessoal (sem dinheiro
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
3. Responda no estilo de uma ficha de casa de apostas: percentual de vitória/empate/derrota e as
   "chances" (over/under) mais relevantes de cada time (escanteios, cartões, gols, etc). Não precisa
   listar as 9 categorias sempre - escolha as mais interessantes pro jogo em questão.

Se a mensagem do usuário já vier com um bloco chamado "DADOS PRÉ-CALCULADOS (seleção manual)": esses
dados já foram calculados a partir dos jogos exatos que o usuário escolheu na tela - NÃO chame
buscar_jogos_rodada nem analisar_confronto de novo, só monte a ficha de análise com esses números.

Regras importantes:
- Nunca invente número. Todo percentual e média vêm exatamente dos dados que as ferramentas (ou o
  bloco de dados pré-calculados) retornarem - se um dado não veio de lá, não afirme.
- São estimativas a partir de um histórico curto, não garantia de resultado - deixe isso implícito
  no tom (ex: "com base nos últimos N jogos"), sem repetir um aviso jurídico toda hora.
- Se não achar o jogo, ou um dos times não tiver jogos suficientes no histórico, diga isso direto em
  vez de inventar números.
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
      'Calcula a estimativa de probabilidade (vitória/empate/derrota) e as chances (over/under) de ' +
      'escanteios, cartões, gols etc. dos dois times, a partir do histórico real dos jogos de cada um ' +
      'antes da rodada informada.',
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

function montarResultadoConfronto(formaMandante, formaVisitante) {
  if (!formaMandante.medias || !formaVisitante.medias) {
    return { erro: 'Não há jogos suficientes no histórico de um dos dois times.' };
  }

  return {
    mandante: {
      jogosAnalisados: formaMandante.medias.jogosAnalisados,
      medias: formaMandante.medias,
      chances: calcularAlertas(formaMandante.jogos, formaMandante.medias),
    },
    visitante: {
      jogosAnalisados: formaVisitante.medias.jogosAnalisados,
      medias: formaVisitante.medias,
      chances: calcularAlertas(formaVisitante.jogos, formaVisitante.medias),
    },
    probabilidade: estimarProbabilidades(formaMandante.medias, formaVisitante.medias),
  };
}

async function analisarConfronto(input, contexto) {
  const campeonatoId = await resolverCampeonatoId();
  const quantidade = input.quantidade ?? contexto?.quantidadePadrao ?? 10;

  const [formaMandante, formaVisitante] = await Promise.all([
    buscarFormaTime(campeonatoId, input.timeMandanteId, input.numeroRodada, quantidade),
    buscarFormaTime(campeonatoId, input.timeVisitanteId, input.numeroRodada, quantidade),
  ]);

  return montarResultadoConfronto(formaMandante, formaVisitante);
}

export async function executarFerramenta(nome, input, contexto) {
  if (nome === 'buscar_jogos_rodada') return buscarJogosRodada(input);
  if (nome === 'analisar_confronto') return analisarConfronto(input, contexto);
  return { erro: `Ferramenta desconhecida: ${nome}` };
}

export const MAX_VOLTAS = 6;

// --- Seleção manual de jogos (fora do loop de tool use) ---
//
// Quando o usuário escolhe manualmente, na tela, quais jogos entram no
// histórico de cada time, o resultado é calculado direto por código (sem
// passar pelo modelo) - o mesmo cálculo de analisar_confronto, só que a
// partir de uma lista explícita de partidas em vez de "últimos N jogos".

export function estimarCustoSelecionados(jogosMandanteIds, jogosVisitanteIds) {
  const todos = [...jogosMandanteIds, ...jogosVisitanteIds];
  const requisicoesNecessarias = todos.filter((id) => !estaCache(`partida:${id}`)).length;
  return { totalSelecionados: todos.length, requisicoesNecessarias };
}

export async function analisarConfrontoManual({ timeMandanteId, jogosMandanteIds, timeVisitanteId, jogosVisitanteIds }) {
  const { requisicoesNecessarias } = estimarCustoSelecionados(jogosMandanteIds, jogosVisitanteIds);
  const restante = LIMITE_DIARIO_API - usoApiHoje();

  if (requisicoesNecessarias > restante) {
    const err = new Error(
      `Isso gastaria ${requisicoesNecessarias} requisição(ões) nova(s) à API Futebol, mas só sobram ` +
        `${restante} hoje (${usoApiHoje()}/${LIMITE_DIARIO_API} usadas). Desmarque alguns jogos ou tente de novo amanhã.`,
    );
    err.status = 409;
    throw err;
  }

  const [formaMandante, formaVisitante] = await Promise.all([
    buscarJogosPorId(timeMandanteId, jogosMandanteIds),
    buscarJogosPorId(timeVisitanteId, jogosVisitanteIds),
  ]);

  return montarResultadoConfronto(formaMandante, formaVisitante);
}
