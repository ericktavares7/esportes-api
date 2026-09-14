// Teste isolado (NÃO integrado no app ainda) pra ver se o API-Football
// mostra o número de escanteios certo pro jogo Goiás x Sport (22/07/2026),
// que já confirmamos manualmente no Sofascore: Goiás 9, Sport 2.
// Nossa fonte atual (API Futebol) mostra Goiás 7 - errado.
//
// Uso: node scripts/testar-api-football.js

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE_URL = 'https://v3.football.api-sports.io';

if (!API_KEY) {
  console.error('API_FOOTBALL_KEY não está no .env');
  process.exit(1);
}

async function chamar(caminho) {
  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    headers: { 'x-apisports-key': API_KEY },
  });
  const dados = await resposta.json();
  if (dados.errors && Object.keys(dados.errors).length > 0) {
    throw new Error(`Erro da API-Football: ${JSON.stringify(dados.errors)}`);
  }
  return dados;
}

async function main() {
  console.log('1. Achando o ID da Série B no API-Football...');
  const ligas = await chamar('/leagues?name=Serie B&country=Brazil');
  console.log(`   Encontradas ${ligas.results} liga(s):`);
  ligas.response.forEach((l) => console.log(`   - id=${l.league.id} "${l.league.name}" (${l.country.name})`));

  const serieB = ligas.response.find((l) => l.league.name.toLowerCase().includes('serie b'));
  if (!serieB) {
    console.error('Não achei a Série B na resposta.');
    return;
  }
  const ligaId = serieB.league.id;

  console.log(`\n2. Buscando jogos de ${ligaId} em 22/07/2026...`);
  const jogos = await chamar(`/fixtures?league=${ligaId}&season=2026&date=2026-07-22`);
  console.log(`   ${jogos.results} jogo(s) encontrado(s) nessa data:`);
  jogos.response.forEach((j) => console.log(`   - fixture=${j.fixture.id} ${j.teams.home.name} x ${j.teams.away.name} (${j.goals.home}x${j.goals.away})`));

  const jogo = jogos.response.find(
    (j) => j.teams.home.name.includes('Goiás') || j.teams.home.name.includes('Goias'),
  );
  if (!jogo) {
    console.error('Não achei o jogo Goiás x Sport nessa data.');
    return;
  }

  console.log(`\n3. Buscando estatísticas do fixture ${jogo.fixture.id}...`);
  const stats = await chamar(`/fixtures/statistics?fixture=${jogo.fixture.id}`);

  stats.response.forEach((ladoStats) => {
    const escanteios = ladoStats.statistics.find((s) => s.type === 'Corner Kicks');
    console.log(`   ${ladoStats.team.name}: escanteios = ${escanteios ? escanteios.value : 'campo não encontrado'}`);
  });

  console.log('\n--- Comparação final ---');
  console.log('Sofascore (real, conferido manualmente): Goiás 9, Sport 2');
  console.log('API Futebol (nossa fonte atual):          Goiás 7, Sport 2');
  console.log('API-Football (acima): ver valores impressos ↑');
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
