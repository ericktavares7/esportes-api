// Teste isolado (NÃO integrado no app ainda) pra comparar escanteios/cartões
// da GOAL API contra a nossa fonte atual (API Futebol) em vários jogos.
// Uso: node scripts/testar-goal-api.js "2026-07-22" "Goiás"
//      (data no formato YYYY-MM-DD, nome do time mandante como aparece na API Futebol)

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const API_KEY = process.env.GOAL_API_KEY;
const BASE_URL = 'https://api.goal-api.com/v1';

if (!API_KEY) {
  console.error('GOAL_API_KEY não está no .env');
  process.exit(1);
}

const [, , dataArg, nomeTimeArg] = process.argv;
if (!dataArg || !nomeTimeArg) {
  console.error('Uso: node scripts/testar-goal-api.js "2026-07-22" "Goiás"');
  process.exit(1);
}

async function chamar(caminho) {
  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const dados = await resposta.json();
  if (!resposta.ok || dados.success === false) {
    throw new Error(`Erro da GOAL API (${resposta.status}): ${JSON.stringify(dados)}`);
  }
  return dados.data;
}

async function main() {
  const fixtures = await chamar(`/fixtures/date/${dataArg}`);
  const lista = Array.isArray(fixtures) ? fixtures : fixtures.fixtures ?? [];

  const jogo = lista.find((f) => {
    const home = f.homeTeam?.name ?? f.home?.name ?? '';
    const away = f.awayTeam?.name ?? f.away?.name ?? '';
    return home.includes(nomeTimeArg) || away.includes(nomeTimeArg);
  });

  if (!jogo) {
    console.error(`Não achei jogo com "${nomeTimeArg}" em ${dataArg}. Times do dia:`, lista.map((f) => `${f.homeTeam?.name ?? f.home?.name} x ${f.awayTeam?.name ?? f.away?.name}`));
    return;
  }

  const nomeHome = jogo.homeTeam?.name ?? jogo.home?.name;
  const nomeAway = jogo.awayTeam?.name ?? jogo.away?.name;
  console.log(`Jogo: ${nomeHome} x ${nomeAway} (fixture ${jogo.id})`);

  const stats = await chamar(`/fixtures/${jogo.id}/statistics`);
  const fullTime = stats.match?.fullTime ?? [];

  const ocorrencias = (tipo) => fullTime.filter((s) => s.type === tipo);
  ['Corners', 'Yellow Cards'].forEach((tipo) => {
    const ocorr = ocorrencias(tipo);
    if (ocorr.length === 0) {
      console.log(`  ${tipo}: não encontrado`);
    } else {
      ocorr.forEach((o, i) => console.log(`  ${tipo} [ocorrência ${i + 1}/${ocorr.length}]: ${nomeHome}=${o.home} / ${nomeAway}=${o.away}`));
    }
  });
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
