import OpenAI from 'openai';
import { SYSTEM_PROMPT, TOOL_DEFS, executarFerramenta, MAX_VOLTAS } from './chatTools.js';

// Responses API - formato de tool "achatado" (sem aninhar em "function" como
// na Chat Completions antiga).
const TOOLS = TOOL_DEFS.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
  strict: false,
}));

export async function responder({ apiKey, model, mensagem, historico = [], quantidadePadrao }) {
  const client = new OpenAI({ apiKey });
  let input = [...historico, { role: 'user', content: mensagem }];

  for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
    const response = await client.responses.create({
      model,
      instructions: SYSTEM_PROMPT,
      tools: TOOLS,
      input,
    });

    input = [...input, ...response.output];

    const chamadas = response.output.filter((item) => item.type === 'function_call');
    if (chamadas.length === 0) {
      return { resposta: response.output_text ?? '', historico: input };
    }

    for (const chamada of chamadas) {
      let resultado;
      try {
        const args = JSON.parse(chamada.arguments || '{}');
        resultado = await executarFerramenta(chamada.name, args, { quantidadePadrao });
      } catch (err) {
        resultado = { erro: err.message };
      }
      input.push({ type: 'function_call_output', call_id: chamada.call_id, output: JSON.stringify(resultado) });
    }
  }

  throw new Error('O assistente não conseguiu concluir a análise (excedeu o limite de chamadas de ferramenta).');
}
