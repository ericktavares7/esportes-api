import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TOOL_DEFS, executarFerramenta, MAX_VOLTAS } from './chatTools.js';

const TOOLS = TOOL_DEFS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,
}));

export async function responder({ apiKey, model, mensagem, historico = [], quantidadePadrao }) {
  const client = new Anthropic({ apiKey });
  const messages = [...historico, { role: 'user', content: mensagem }];

  for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      thinking: { type: 'adaptive' },
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'refusal') {
      return { resposta: 'Não consegui responder essa (o modelo recusou). Tenta reformular a pergunta.', historico: messages };
    }

    if (response.stop_reason !== 'tool_use') {
      const textos = response.content.filter((b) => b.type === 'text').map((b) => b.text);
      return { resposta: textos.join('\n\n'), historico: messages };
    }

    const chamadas = response.content.filter((b) => b.type === 'tool_use');
    const resultados = await Promise.all(
      chamadas.map(async (chamada) => {
        try {
          const resultado = await executarFerramenta(chamada.name, chamada.input, { quantidadePadrao });
          return { type: 'tool_result', tool_use_id: chamada.id, content: JSON.stringify(resultado) };
        } catch (err) {
          return { type: 'tool_result', tool_use_id: chamada.id, content: err.message, is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: resultados });
  }

  throw new Error('O assistente não conseguiu concluir a análise (excedeu o limite de chamadas de ferramenta).');
}
