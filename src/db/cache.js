import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pastaDados = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(pastaDados, { recursive: true });

const db = new DatabaseSync(path.join(pastaDados, 'cache.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    expira_em INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS uso_api (
    dia TEXT PRIMARY KEY,
    requisicoes INTEGER NOT NULL
  )
`);

const stmtBuscar = db.prepare('SELECT valor, expira_em FROM cache WHERE chave = ?');
const stmtSalvar = db.prepare(
  'INSERT INTO cache (chave, valor, expira_em) VALUES (?, ?, ?) ' +
    'ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, expira_em = excluded.expira_em',
);

const stmtIncrementarUso = db.prepare(
  'INSERT INTO uso_api (dia, requisicoes) VALUES (?, 1) ' +
    'ON CONFLICT(dia) DO UPDATE SET requisicoes = requisicoes + 1',
);
const stmtBuscarUso = db.prepare('SELECT requisicoes FROM uso_api WHERE dia = ?');

function diaDeHoje() {
  return new Date().toISOString().slice(0, 10);
}

// Quantas chamadas reais (nao vindas do cache) foram feitas pra API hoje.
// So conta o que de fato saiu pra rede - HITs de cache nao contam.
export function usoApiHoje() {
  const linha = stmtBuscarUso.get(diaDeHoje());
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
export async function comCache(chave, ttl, buscarDados) {
  const linha = stmtBuscar.get(chave);
  const agora = Date.now();

  if (linha && linha.expira_em > agora) {
    console.log(`[cache] HIT  ${chave}`);
    return JSON.parse(linha.valor);
  }

  console.log(`[cache] MISS ${chave}`);
  try {
    const dados = await buscarDados();
    stmtIncrementarUso.run(diaDeHoje());
    const ttlSegundos = typeof ttl === 'function' ? ttl(dados) : ttl;
    stmtSalvar.run(chave, JSON.stringify(dados), agora + ttlSegundos * 1000);
    return dados;
  } catch (err) {
    if (linha) {
      console.log(`[cache] STALE ${chave} (API falhou, usando cópia vencida)`);
      return JSON.parse(linha.valor);
    }
    throw err;
  }
}
