// Script isolado pra validar a extensão do comparativo pré-jogo/perfil de
// time pra Série A (fonte GOAL API) antes de confiar na UI - mesmo padrão do
// testar-motor-palpites.js, mas usando o adaptador buscarFormaTimeSerieA
// (dentro de formaService.js) em vez do caminho da API Futebol.
// Uso: node scripts/testar-comparativo-serie-a.js

import {
  CAMPEONATO_SERIE_A_ID,
  buscarCampeonatoInfoSerieA,
  buscarRodadaSerieA,
} from '../src/services/goalApiService.js';
import { buscarFormaTime } from '../src/services/formaService.js';
import { gerarPalpites } from '../src/services/motorPalpites.js';

const MAX_CONFRONTOS = 3;
const JOGOS_JANELA = 7; // mesmo valor usado dentro do motor - só pra reexibir os jogos que ele usou

function imprimirJogos(nomeTime, mando, jogos) {
  console.log(`\n${nomeTime} (${mando}) - ${jogos.length} jogo(s) usados:`);
  jogos.forEach((j) => {
    const data = new Date(j.data).toLocaleDateString('pt-BR');
    console.log(
      `  ${data}  ${j.mandante ? 'vs' : '@ '} ${j.adversario.padEnd(20)} ` +
      `placar ${j.placar.padEnd(6)} escanteios ${j.escanteios}x${j.escanteiosContra}  ` +
      `cartões ${j.cartoesAmarelos}x${j.cartoesAmarelosContra}  faltas ${j.faltas}  ` +
      `finalizações ${j.finalizacoes} (${j.chutesNoGol} no gol)  posse ${j.posseDeBola}%`,
    );
  });
}

async function main() {
  const info = await buscarCampeonatoInfoSerieA();
  if (!info?.rodada_atual) {
    console.error('Não achei rodada_atual pra Série A.');
    process.exit(1);
  }

  let rodada = await buscarRodadaSerieA(info.rodada_atual.rodada);
  let tentativas = 0;
  while (rodada.proxima_rodada && (rodada.partidas ?? []).every((p) => p.status !== 'agendado') && tentativas < 5) {
    rodada = await buscarRodadaSerieA(rodada.proxima_rodada.rodada);
    tentativas += 1;
  }

  const agendados = (rodada.partidas ?? []).filter((p) => p.status === 'agendado').slice(0, MAX_CONFRONTOS);
  const candidatos = agendados.length > 0 ? agendados : (rodada.partidas ?? []).slice(0, MAX_CONFRONTOS);
  if (candidatos.length === 0) {
    console.error('Nenhum jogo encontrado nessa rodada pra testar.');
    process.exit(1);
  }

  console.log(`Rodada usada: ${rodada.nome} (nº ${rodada.rodada})`);
  console.log(`Testando ${candidatos.length} confronto(s):\n`);

  for (const partida of candidatos) {
    console.log('='.repeat(70));
    console.log(`${partida.time_mandante.nome_popular} x ${partida.time_visitante.nome_popular} - ${partida.data_realizacao} ${partida.hora_realizacao ?? ''}`);
    console.log('='.repeat(70));

    try {
      const [formaMandante, formaVisitante] = await Promise.all([
        buscarFormaTime(CAMPEONATO_SERIE_A_ID, partida.time_mandante.time_id, rodada.rodada, JOGOS_JANELA, true),
        buscarFormaTime(CAMPEONATO_SERIE_A_ID, partida.time_visitante.time_id, rodada.rodada, JOGOS_JANELA, false),
      ]);
      imprimirJogos(partida.time_mandante.nome_popular, 'casa', formaMandante.jogos);
      imprimirJogos(partida.time_visitante.nome_popular, 'fora', formaVisitante.jogos);

      const resultado = await gerarPalpites(
        CAMPEONATO_SERIE_A_ID,
        partida.time_mandante.time_id,
        partida.time_visitante.time_id,
        rodada.rodada,
      );
      console.log('\nSaída do motor:');
      console.log(JSON.stringify(resultado, null, 2));
    } catch (err) {
      console.error(`Erro ao gerar comparativo/palpites: ${err.stack}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
