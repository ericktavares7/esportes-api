import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matchesRouter from './routes/matches.routes.js';
import campeonatosRouter from './routes/campeonatos.routes.js';
import timesRouter from './routes/times.routes.js';
import chatRouter from './routes/chat.routes.js';
import palpitesRouter from './routes/palpites.routes.js';
import { usoApiHoje } from './db/cache.js';
import { LIMITE_DIARIO_API, LIMITE_DIARIO_GOAL_API } from './config/limites.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Permite o Express entender JSON no corpo das requisições (POST/PUT)
app.use(express.json());

// Serve a pasta public/ como site estático: qualquer arquivo (index.html,
// style.css, script.js) fica acessível direto pela raiz da URL.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check da API (separado da página, pra não conflitar com o index.html)
// usoApi vem separado por provedor - API Futebol (100/dia) e GOAL API
// (1000/dia, usada pela Série A e pela correção de escanteios/cartões da
// Série B) tem cotas bem diferentes; misturar as duas num contador só faria
// a Série A "estourar" a cota de 100 sem nem chegar perto da cota real dela.
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Sport Analytics rodando',
    usoApi: {
      apiFutebol: { hoje: usoApiHoje('api-futebol'), limite: LIMITE_DIARIO_API },
      goalApi: { hoje: usoApiHoje('goal-api'), limite: LIMITE_DIARIO_GOAL_API },
    },
  });
});

app.use('/api/matches', matchesRouter);
app.use('/api/campeonatos', campeonatosRouter);
app.use('/api/times', timesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/palpites', palpitesRouter);

// Middleware de erro: fica por último, o Express só chama isso quando
// algum handler faz next(err). Centraliza o tratamento de falhas da API externa
// (axios, com err.response.status) e de erros próprios (ex: chat, com err.status).
app.use((err, req, res, next) => {
  console.error(err.message);
  const status = err.response?.status ?? err.status ?? 500;
  // A API Futebol devolve erros como { message, code }; guarda fallback pro
  // formato antigo ({ errors }) e pra mensagem genérica do axios.
  const detalheExterno = err.response?.data?.message ?? err.response?.data?.errors;
  res.status(status).json({
    error: 'Erro ao consultar dados esportivos',
    detail: detalheExterno ?? err.message,
  });
});

export default app;
