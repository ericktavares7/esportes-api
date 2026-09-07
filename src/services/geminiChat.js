import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, TOOL_DEFS, executarFerramenta, MAX_VOLTAS } from './chatTools.js';

const TOOLS = TOOL_DEFS.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}));

// O SDK do Gemini devolve um err.message genérico ("400 API error occurred: ...")
// e guarda o motivo real dentro de err.body (uma string JSON). Sem isso o
// usuário só veria um blob ilegível em vez de "API key not valid", por exemplo.
function extrairMensagemErro(err) {
  try {
    const corpo = JSON.parse(err.body);
    const mensagem = corpo?.[0]?.error?.message;
    if (mensagem) return mensagem;
  } catch {
    // err.body não veio no formato esperado - usa err.message mesmo
  }
  return err.message;
}

export async function responder({ apiKey, model, mensagem, historico = [], quantidadePadrao }) {
  const ai = new GoogleGenAI({ apiKey });
  let conversa = [...historico, { type: 'user_input', content: [{ type: 'text', text: mensagem }] }];

  for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
    let response;
    try {
      response = await ai.interactions.create({
        model,
        system_instruction: SYSTEM_PROMPT,
        tools: TOOLS,
        input: conversa,
      });
    } catch (err) {
      throw new Error(extrairMensagemErro(err));
    }

    conversa = [...conversa, ...response.steps];

    const chamadas = response.steps.filter((step) => step.type === 'function_call');
    if (chamadas.length === 0) {
      return { resposta: response.output_text ?? '', historico: conversa };
    }

    for (const chamada of chamadas) {
      let resultado;
      try {
        resultado = await executarFerramenta(chamada.name, chamada.arguments ?? {}, { quantidadePadrao });
      } catch (err) {
        resultado = { erro: err.message };
      }
      conversa.push({ type: 'function_result', name: chamada.name, call_id: chamada.id, result: JSON.stringify(resultado) });
    }
  }

  throw new Error('O assistente não conseguiu concluir a análise (excedeu o limite de chamadas de ferramenta).');
}
