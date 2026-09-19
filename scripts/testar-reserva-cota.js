// Teste isolado da reserva de cota: simula a API Futebol respondendo 429
// ("limite diário") e confere que buscarFormaTime da Série B cai pra GOAL API
// sozinho. NÃO gasta cota real da API Futebol - aponta pra um servidor local.
// Uso: node scripts/testar-reserva-cota.js

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Banco de cache vazio e descartável: com o cache real, rodadas/partidas já
// guardadas respondem sem tocar a rede e o teste não exercitaria a reserva.
const arquivoCache = path.join(os.tmpdir(), `cache-teste-reserva-${Date.now()}.sqlite`);
process.env.CACHE_DB_PATH = arquivoCache;

let chamadasAoServidorFalso = 0;
const servidor = http.createServer((req, res) => {
  chamadasAoServidorFalso += 1;
  res.writeHead(429, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Você atingiu o limite diário de requisições.' }));
});
await new Promise((resolve) => servidor.listen(0, resolve));
process.env.API_FUTEBOL_BASE_URL = `http://localhost:${servidor.address().port}`;

// imports dinâmicos DEPOIS de setar a env, senão env.js já teria lido a URL real
const { buscarFormaTime, buscarFormaComMando } = await import('../src/services/formaService.js');

const SPORT = 79; // Sport (API Futebol) -> mapeado pra GOAL API
const SEM_MAPEAMENTO = 999999;
const CAMPEONATO_SERIE_B = 14;

function imprimir(titulo, forma) {
  console.log(`\n${titulo}`);
  console.log(`  fonteAlternativa: ${forma.fonteAlternativa ?? '(nenhuma)'}  jogos: ${forma.jogosObtidos}/${forma.jogosTentados}`);
  forma.jogos.forEach((j) => {
    console.log(
      `  ${new Date(j.data).toLocaleDateString('pt-BR')}  ${j.mandante ? 'vs' : '@ '} ${j.adversario.padEnd(18)} ${j.placar.padEnd(6)} ` +
      `escanteios ${j.escanteios}x${j.escanteiosContra}  cartões ${j.cartoesAmarelos}x${j.cartoesAmarelosContra}`,
    );
  });
  if (forma.medias) console.log(`  médias: gols ${forma.medias.mediaGolsPro}/${forma.medias.mediaGolsContra}  escanteios ${forma.medias.mediaEscanteios}`);
}

try {
  // quantidade/rodada pouco usados pra não bater em cache antigo de forma
  imprimir('1) Perfil do Sport (sem filtro de mando), antes da rodada 29, 6 jogos', await buscarFormaTime(CAMPEONATO_SERIE_B, SPORT, 29, 6));
  console.log(`  chamadas que chegaram no servidor 429: ${chamadasAoServidorFalso}`);

  const antes = chamadasAoServidorFalso;
  imprimir('2) Mesmo time de novo, outra quantidade (reserva já ativa: não deve tentar a API Futebol)', await buscarFormaTime(CAMPEONATO_SERIE_B, SPORT, 29, 7));
  console.log(`  novas chamadas ao servidor 429: ${chamadasAoServidorFalso - antes} (esperado: 0)`);

  imprimir('3) Comparativo (Sport em casa, rodada 29)', await buscarFormaComMando(CAMPEONATO_SERIE_B, SPORT, 29, 5, true));

  console.log('\n4) Time SEM mapeamento: precisa continuar falhando com o erro de cota original');
  try {
    await buscarFormaTime(CAMPEONATO_SERIE_B, SEM_MAPEAMENTO, 29, 5);
    console.log('  ERRO: deveria ter falhado');
  } catch (err) {
    console.log(`  falhou como esperado: ${err.response?.status ?? err.message}`);
  }
} finally {
  servidor.close();
  // No Windows o SQLite ainda segura o arquivo aberto até o processo acabar;
  // se não der pra apagar agora, sobra um .sqlite pequeno na pasta temp.
  try {
    fs.rmSync(arquivoCache, { force: true });
  } catch {
    // ignorado de propósito
  }
}
