import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matchesRouter from './routes/matches.routes.js';
import campeonatosRouter from './routes/campeonatos.routes.js';
import timesRouter from './routes/times.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Permite o Express entender JSON no corpo das requisições (POST/PUT)
app.use(express.json());

// Serve a pasta public/ como site estático: qualquer arquivo (index.html,
// style.css, script.js) fica acessível direto pela raiz da URL.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check da API (separado da página, pra não conflitar com o index.html)
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'API de Esportes rodando' });
});

app.use('/api/matches', matchesRouter);
app.use('/api/campeonatos', campeonatosRouter);
app.use('/api/times', timesRouter);

// Middleware de erro: fica por último, o Express só chama isso quando
// algum handler faz next(err). Centraliza o tratamento de falhas da API externa.
app.use((err, req, res, next) => {
  console.error(err.message);
  const status = err.response?.status ?? 500;
  // A API Futebol devolve erros como { message, code }; guarda fallback pro
  // formato antigo ({ errors }) e pra mensagem genérica do axios.
  const detalheExterno = err.response?.data?.message ?? err.response?.data?.errors;
  res.status(status).json({
    error: 'Erro ao consultar dados esportivos',
    detail: detalheExterno ?? err.message,
  });
});

export default app;
