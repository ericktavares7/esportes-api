import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const PORT = process.env.PORT || 3000;
export const API_FUTEBOL_KEY = process.env.API_FUTEBOL_KEY;
// Sobrescrevível só pra testar (ver scripts/testar-reserva-cota.js, que
// aponta pra um servidor local simulando "cota esgotada") - em uso normal
// nunca é definida e vale a URL real.
export const API_FUTEBOL_BASE_URL = process.env.API_FUTEBOL_BASE_URL || 'https://api.api-futebol.com.br/v1';
// Fonte principal de todos os dados de futebol (ver goalApiService.js).
export const GOAL_API_KEY = process.env.GOAL_API_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!GOAL_API_KEY) {
  console.warn('Aviso: GOAL_API_KEY nao foi definida no .env - o app depende dela pra todos os dados de futebol.');
}

// As três chaves de IA são opcionais no servidor - a aba Chat deixa cada
// usuário colar a própria chave na engrenagem (fica só no navegador dele).
// As variáveis aqui servem só de fallback pra quem preferir configurar uma
// vez no servidor em vez de em cada navegador.
if (!ANTHROPIC_API_KEY && !OPENAI_API_KEY && !GEMINI_API_KEY) {
  console.warn('Aviso: nenhuma chave de IA (ANTHROPIC/OPENAI/GEMINI_API_KEY) definida no .env - a aba Chat só vai funcionar se o usuário configurar uma chave pela engrenagem.');
}
