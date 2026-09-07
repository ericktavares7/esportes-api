import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  GEMINI_API_KEY,
  GEMINI_MODEL,
} from '../config/env.js';
import { responder as responderAnthropic } from './anthropicChat.js';
import { responder as responderOpenAI } from './openaiChat.js';
import { responder as responderGemini } from './geminiChat.js';

// Cada provedor tem seu formato de histórico próprio (blocos do Claude, itens
// da Responses API, "steps" do Gemini) - por isso o front-end reseta o
// histórico da conversa sempre que troca de provedor nas configurações.
const PROVEDORES = {
  anthropic: { responder: responderAnthropic, apiKeyEnv: ANTHROPIC_API_KEY, modelEnv: ANTHROPIC_MODEL },
  openai: { responder: responderOpenAI, apiKeyEnv: OPENAI_API_KEY, modelEnv: OPENAI_MODEL },
  gemini: { responder: responderGemini, apiKeyEnv: GEMINI_API_KEY, modelEnv: GEMINI_MODEL },
};

export async function responder({ mensagem, historico = [], provedor = 'anthropic', apiKey, modelo, quantidadePadrao }) {
  const config = PROVEDORES[provedor];
  if (!config) {
    const err = new Error(`Provedor de IA desconhecido: ${provedor}`);
    err.status = 400;
    throw err;
  }

  const chaveEfetiva = apiKey || config.apiKeyEnv;
  if (!chaveEfetiva) {
    const err = new Error(
      `Nenhuma chave de API configurada para ${provedor}. Configure na engrenagem do chat, ou defina no .env do servidor.`,
    );
    err.status = 503;
    throw err;
  }

  return config.responder({
    apiKey: chaveEfetiva,
    model: modelo || config.modelEnv,
    mensagem,
    historico,
    quantidadePadrao,
  });
}
