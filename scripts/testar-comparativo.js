// Script isolado pra validar comparativo pré-jogo / forma / motor de palpites
// contra jogos reais (GOAL API) sem passar pela interface.
// Uso: node scripts/testar-comparativo.js                 (Série B)
//      CAMPEONATO_TESTE=goal-serie-a node scripts/testar-comparativo.js
//
// Acha a próxima rodada com jogos agendados e roda o motor pros primeiros
// confrontos dela, imprimindo o histórico jogo a jogo que ele usou.

import { buscarCampeonatoInfo, buscarRodada, CAMPEONATO_SERIE_B_ID } from '../src/services/goalApiService.js';
import { buscarFormaTime } from '../src/services/formaService.js';
import { gerarPalpites } from '../src/services/motorPalpites.js';

const CAMPEONATO_ID = process.env.CAMPEONATO_TESTE ?? CAMPEONATO_SERIE_B_ID;
const MAX_CONFRONTOS = 3;
const JOGOS_JANELA = 8; // mesmo valor do motor

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
  const info = await buscarCampeonatoInfo(CAMPEONATO_ID);
  if (!info?.rodada_atual) {
    console.error('Não achei rodada_atual pra esse campeonato.');
    process.exit(1);
  }

  let rodada = await buscarRodada(CAMPEONATO_ID, info.rodada_atual.rodada);
  let tentativas = 0;
  while (rodada.proxima_rodada && (rodada.partidas ?? []).every((p) => p.status !== 'agendado') && tentativas < 5) {
    rodada = await buscarRodada(CAMPEONATO_ID, rodada.proxima_rodada.rodada);
    tentativas += 1;
  }

  const agendados = (rodada.partidas ?? []).filter((p) => p.status === 'agendado').slice(0, MAX_CONFRONTOS);
  const candidatos = agendados.length > 0 ? agendados : (rodada.partidas ?? []).slice(0, MAX_CONFRONTOS);
  if (candidatos.length === 0) {
    console.error('Nenhum jogo encontrado nessa rodada pra testar.');
    process.exit(1);
  }

  console.log(`${info.nome_popular} - ${rodada.nome}`);
  console.log(`Testando ${candidatos.length} confronto(s):\n`);

  for (const partida of candidatos) {
    console.log('='.repeat(70));
    console.log(`${partida.time_mandante.nome_popular} x ${partida.time_visitante.nome_popular} - ${partida.data_realizacao} ${partida.hora_realizacao ?? ''}`);
    console.log('='.repeat(70));

    try {
      const [formaMandante, formaVisitante] = await Promise.all([
        buscarFormaTime(CAMPEONATO_ID, partida.time_mandante.time_id, rodada.rodada, JOGOS_JANELA, true),
        buscarFormaTime(CAMPEONATO_ID, partida.time_visitante.time_id, rodada.rodada, JOGOS_JANELA, false),
      ]);
      imprimirJogos(partida.time_mandante.nome_popular, 'casa', formaMandante.jogos);
      imprimirJogos(partida.time_visitante.nome_popular, 'fora', formaVisitante.jogos);

      const resultado = await gerarPalpites(
        CAMPEONATO_ID,
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
