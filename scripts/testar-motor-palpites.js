// Script isolado pra rodar o motor de palpites (src/services/motorPalpites.js)
// contra jogos reais e imprimir o JSON de saída, sem passar pela interface.
// Uso: node scripts/testar-motor-palpites.js
//
// Pega o campeonato configurado, acha a próxima rodada com jogos agendados e
// roda o motor pros 3 primeiros confrontos dela.

import { getCampeonatos, getRodada } from '../src/services/apiFutebolService.js';
import { buscarFormaTime } from '../src/services/formaService.js';
import { gerarPalpites } from '../src/services/motorPalpites.js';
import { usoApiHoje } from '../src/db/cache.js';
import { LIMITE_DIARIO_API } from '../src/config/limites.js';

const CAMPEONATO_ID = Number(process.env.CAMPEONATO_TESTE ?? 14); // Brasileirão Série B
const MAX_CONFRONTOS = 3;
const JOGOS_JANELA = 7; // mesmo valor usado dentro do motor - só pra reexibir os jogos que ele usou

function imprimirJogos(nomeTime, mando, jogos) {
  console.log(`\n${nomeTime} (${mando}) - ${jogos.length} jogo(s) usados:`);
  jogos.forEach((j) => {
    const data = new Date(j.data).toLocaleDateString('pt-BR');
    console.log(
      `  ${data}  ${j.mandante ? 'vs' : '@ '} ${j.adversario.padEnd(20)} ` +
      `placar ${j.placar.padEnd(6)} escanteios ${j.escanteios}x${j.escanteiosContra}  ` +
      `cartões ${j.cartoesAmarelos}x${j.cartoesAmarelosContra}  faltas ${j.faltas}`,
    );
  });
}

function temJogoAtualOuFuturo(partidas) {
  if (!partidas || partidas.length === 0) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return partidas.some((p) => {
    const data = new Date(p.data_realizacao_iso ?? p.data_realizacao);
    data.setHours(0, 0, 0, 0);
    return data >= hoje;
  });
}

async function main() {
  console.log(`Cota antes de começar: ${usoApiHoje()}/${LIMITE_DIARIO_API}\n`);

  const campeonatos = await getCampeonatos();
  const info = campeonatos.find((c) => c.campeonato_id === CAMPEONATO_ID);
  if (!info?.rodada_atual) {
    console.error('Não achei rodada_atual pro campeonato configurado.');
    process.exit(1);
  }

  let rodada = await getRodada(CAMPEONATO_ID, info.rodada_atual.rodada);
  let tentativas = 0;
  while (rodada.proxima_rodada && !temJogoAtualOuFuturo(rodada.partidas) && tentativas < 5) {
    rodada = await getRodada(CAMPEONATO_ID, rodada.proxima_rodada.rodada);
    tentativas += 1;
  }

  const agendados = (rodada.partidas ?? []).filter((p) => p.status === 'agendado').slice(0, MAX_CONFRONTOS);
  if (agendados.length === 0) {
    console.error('Nenhum jogo agendado encontrado pra testar.');
    process.exit(1);
  }

  console.log(`Rodada usada: ${rodada.nome} (nº ${rodada.rodada})`);
  console.log(`Testando ${agendados.length} confronto(s):\n`);

  for (const partida of agendados) {
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
      console.error(`Erro ao gerar palpites: ${err.message}`);
    }
    console.log('');
  }

  console.log(`Cota depois: ${usoApiHoje()}/${LIMITE_DIARIO_API}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
