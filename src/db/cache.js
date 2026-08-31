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

const stmtBuscar = db.prepare('SELECT valor, expira_em FROM cache WHERE chave = ?');
const stmtSalvar = db.prepare(
  'INSERT INTO cache (chave, valor, expira_em) VALUES (?, ?, ?) ' +
    'ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, expira_em = excluded.expira_em',
);

// Padrao "cache-aside": tenta ler do SQLite primeiro; se nao tiver ou tiver
// vencido, chama buscarDados() (a API real), salva o resultado e devolve.
// Chamadas repetidas dentro do prazo nao geram nenhuma requisicao nova pra
// API Futebol.
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
  const dados = await buscarDados();
  const ttlSegundos = typeof ttl === 'function' ? ttl(dados) : ttl;
  stmtSalvar.run(chave, JSON.stringify(dados), agora + ttlSegundos * 1000);
  return dados;
}
