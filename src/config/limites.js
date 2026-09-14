// A API Futebol não informa o limite via resposta; esse número reflete o
// plano atual (visto em /me). Ajuste aqui se o plano mudar.
export const LIMITE_DIARIO_API = 100;

// GOAL API informa o limite real via header x-ratelimit-limit nas respostas
// (ver [[project-goal-api-integration]] na memória) - 1000/dia no plano
// atual, bem mais folgado que a API Futebol.
export const LIMITE_DIARIO_GOAL_API = 1000;
