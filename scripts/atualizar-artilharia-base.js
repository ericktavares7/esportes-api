// Regenera src/config/artilhariaBase.json: a artilharia de cada liga apurada
// a partir dos eventos de gol de TODOS os jogos encerrados (ver comentário
// "Artilharia" em src/services/goalApiService.js pra entender por que existe).
//
// Uso: node scripts/atualizar-artilharia-base.js
// Depois: git add src/config/artilhariaBase.json && commit/push.
//
// Não é obrigatório rodar com frequência - o app só busca sozinho os jogos que
// acabaram depois da base (~10 chamadas por rodada nova). Rodar de vez em
// quando (ex: a cada poucas rodadas) mantém isso barato em produção.
// Custo: 1 chamada da GOAL API por jogo encerrado que ainda não esteja em
// cache local (~280 por liga na primeira vez).

import fs from 'node:fs';
import { gerarBaseArtilharia, CAMPEONATO_SERIE_A_ID, CAMPEONATO_SERIE_B_ID } from '../src/services/goalApiService.js';

const ARQUIVO = new URL('../src/config/artilhariaBase.json', import.meta.url);
const base = {};

for (const id of [CAMPEONATO_SERIE_B_ID, CAMPEONATO_SERIE_A_ID]) {
  base[id] = await gerarBaseArtilharia(id);
  const topo = base[id].artilheiros[0];
  console.log(`${id}: ${base[id].fixtures.length} jogos, ${base[id].artilheiros.length} artilheiros (lider: ${topo?.atleta.nome_popular} ${topo?.gols})`);
}

fs.writeFileSync(ARQUIVO, `${JSON.stringify(base)}\n`);
console.log(`Base gravada em src/config/artilhariaBase.json (${Math.round(fs.statSync(ARQUIVO).size / 1024)} KB)`);
