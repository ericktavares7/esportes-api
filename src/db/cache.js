import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pastaDados = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(pastaDados, { recursive: true });

// CACHE_DB_PATH só existe pra testes isolados usarem um banco vazio (senão o
// cache real mascara chamadas de rede que o teste quer exercitar).
const db = new DatabaseSync(process.env.CACHE_DB_PATH || path.join(pastaDados, 'cache.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    expira_em INTEGER NOT NULL
  )
`);

// Contagem por provedor (nao um total unico) - a API Futebol (100/dia) e a
// GOAL API (1000/dia) tem cotas bem diferentes, e desde que a GOAL API
// passou a alimentar a Serie A inteira (ver [[project-serie-a-test]]), um
// contador so misturaria as duas e mostraria a Serie A "estourando" a cota
// de 100 da API Futebol sem ter chegado nem perto da cota de verdade dela
// (1000). "provider" e uma string curta tipo 'api-futebol'/'goal-api'.
db.exec(`
  CREATE TABLE IF NOT EXISTS uso_api_provider (
    dia TEXT NOT NULL,
    provider TEXT NOT NULL,
    requisicoes INTEGER NOT NULL,
    PRIMARY KEY (dia, provider)
  )
`);

// Exposto pra módulos que precisam de tabelas próprias no mesmo arquivo
// (auditoria de palpites). Lembrete: no Render o disco é efêmero.
export const bancoLocal = db;

const stmtBuscar = db.prepare('SELECT valor, expira_em FROM cache WHERE chave = ?');
const stmtSalvar = db.prepare(
  'INSERT INTO cache (chave, valor, expira_em) VALUES (?, ?, ?) ' +
    'ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, expira_em = excluded.expira_em',
);

const stmtIncrementarUso = db.prepare(
  'INSERT INTO uso_api_provider (dia, provider, requisicoes) VALUES (?, ?, 1) ' +
    'ON CONFLICT(dia, provider) DO UPDATE SET requisicoes = requisicoes + 1',
);
const stmtBuscarUso = db.prepare('SELECT requisicoes FROM uso_api_provider WHERE dia = ? AND provider = ?');

function diaDeHoje() {
  return new Date().toISOString().slice(0, 10);
}

// Quantas chamadas reais (nao vindas do cache) foram feitas pra esse
// provedor hoje. So conta o que de fato saiu pra rede - HITs de cache nao
// contam. provider default 'api-futebol' mantem os callers antigos (que
// nunca lidaram com GOAL API) funcionando sem precisar passar nada.
export function usoApiHoje(provider = 'api-futebol') {
  const linha = stmtBuscarUso.get(diaDeHoje(), provider);
  return linha?.requisicoes ?? 0;
}

// Padrao "cache-aside" com fallback pra dado velho: tenta ler do SQLite
// primeiro; se nao tiver ou tiver vencido, chama buscarDados() (a API real).
// Se a API falhar (ex: cota diaria estourada) mas existir uma copia antiga
// no banco - mesmo vencida - devolve ela em vez de quebrar a tela: um dado
// de ontem e melhor que nenhum dado. So propaga o erro quando NUNCA existiu
// nada salvo pra essa chave.
//
// ttl pode ser um numero fixo de segundos, ou uma funcao (dados) => segundos
// - assim o prazo de validade pode depender do proprio conteudo (ex: um jogo
// ja encerrado guarda um TTL bem maior que um jogo ainda agendado).
//
// provider identifica de qual API o contador de uso deve descontar
// ('api-futebol' por padrao - os callers da API Futebol nao precisam passar
// nada; goalApiService.js passa 'goal-api' explicitamente em toda chamada).
export async function comCache(chave, ttl, buscarDados, provider = 'api-futebol') {
  const linha = stmtBuscar.get(chave);
  const agora = Date.now();

  if (linha && linha.expira_em > agora) {
    console.log(`[cache] HIT  ${chave}`);
    return JSON.parse(linha.valor);
  }

  console.log(`[cache] MISS ${chave}`);
  try {
    const dados = await buscarDados();
    stmtIncrementarUso.run(diaDeHoje(), provider);
    const ttlSegundos = typeof ttl === 'function' ? ttl(dados) : ttl;
    stmtSalvar.run(chave, JSON.stringify(dados), agora + ttlSegundos * 1000);
    return dados;
  } catch (err) {
    // Um erro com resposta HTTP (ex: 429 "limite diário atingido") significa
    // que a chamada realmente saiu pra API e foi contada do lado deles -
    // por isso soma aqui também, não só nos sucessos. Erro sem resposta
    // nenhuma (timeout, DNS, rede caiu) nunca chegou no servidor deles,
    // então não conta. Sem isso o contador ficava sempre desincronizado do
    // real assim que a cota estourava, já que toda tentativa passava a falhar.
    if (err.response) {
      stmtIncrementarUso.run(diaDeHoje(), provider);
    }
    if (linha) {
      console.log(`[cache] STALE ${chave} (API falhou, usando cópia vencida)`);
      return JSON.parse(linha.valor);
    }
    throw err;
  }
}
