import { DatabaseSync } from 'node:sqlite';
const { default: app } = await import('../src/app.js');
const servidor = app.listen(0);
await new Promise((r) => servidor.on('listening', r));
const base = `http://localhost:${servidor.address().port}`;
const get = async (p) => { const r = await fetch(base + p); let corpo; try { corpo = await r.json(); } catch { corpo = null; } return { status: r.status, corpo }; };
const linha = (nome, ok, extra = '') => console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome} ${extra}`);

const camp = await get('/api/campeonatos');
linha('campeonatos', camp.status === 200 && camp.corpo.length === 2, JSON.stringify(camp.corpo.map((c) => `${c.campeonato_id}:${c.nome_popular}:rodada ${c.rodada_atual?.rodada}`)));

for (const id of ['goal-serie-b', 'goal-serie-a']) {
  const info = camp.corpo.find((c) => c.campeonato_id === id);
  const rod = await get(`/api/campeonatos/${id}/rodadas/${info.rodada_atual.rodada}`);
  const p = rod.corpo.partidas[0];
  linha(`${id} rodada ${info.rodada_atual.rodada}`, rod.status === 200 && rod.corpo.partidas.length > 0, `${rod.corpo.partidas.length} jogos; 1o: ${p.time_mandante.nome_popular} x ${p.time_visitante.nome_popular} ${p.data_realizacao} ${p.hora_realizacao}; anterior ${rod.corpo.rodada_anterior?.rodada} proxima ${rod.corpo.proxima_rodada?.rodada}`);
  const tab = await get(`/api/campeonatos/${id}/tabela`);
  linha(`${id} tabela`, tab.status === 200 && tab.corpo.length === 20, `lider ${tab.corpo[0].time.nome_popular} ${tab.corpo[0].pontos}pts; faixas: ${[...new Set(tab.corpo.map((l) => l.faixa_classificacao))].join(',')}`);
  const art = await get(`/api/campeonatos/${id}/artilharia`);
  linha(`${id} artilharia`, art.status === 200 && art.corpo.length > 0, `${art.corpo[0].atleta.nome_popular} ${art.corpo[0].gols}`);
  const mandante = p.time_mandante.time_id, visitante = p.time_visitante.time_id;
  const forma = await get(`/api/times/${mandante}/forma?campeonato=${id}&antes=${info.rodada_atual.rodada}&quantidade=10`);
  linha(`${id} forma (perfil)`, forma.status === 200 && forma.corpo.jogos.length > 0, `${forma.corpo.jogosObtidos}/${forma.corpo.jogosTentados} jogos`);
  const formaMando = await get(`/api/times/${mandante}/forma?campeonato=${id}&antes=${info.rodada_atual.rodada}&quantidade=10&mando=casa`);
  linha(`${id} forma (mando=casa)`, formaMando.status === 200, `mandoEspecifico=${formaMando.corpo.mandoEspecifico}`);
  const pal = await get(`/api/palpites/confronto?campeonato=${id}&mandante=${mandante}&visitante=${visitante}&rodada=${info.rodada_atual.rodada}`);
  linha(`${id} palpites`, pal.status === 200, `${pal.corpo?.confronto}: ${pal.corpo?.palpites?.length} palpites`);
  const passado = forma.corpo.jogos[0];
  const resumo = await get(`/api/matches/${passado.partidaId}/summary`);
  linha(`${id} resumo de jogo passado`, resumo.status === 200, `${resumo.corpo?.confronto?.mandante} ${resumo.corpo?.confronto?.placar} ${resumo.corpo?.confronto?.visitante} | ${resumo.corpo?.partida?.campeonato}`);
  const res = await get(`/api/matches/${passado.partidaId}/resultado`);
  linha(`${id} resultado`, res.status === 200 && res.corpo.status === 'finalizado', JSON.stringify(res.corpo));
}

const live = await get('/api/matches/live');
linha('ao vivo', live.status === 200 && Array.isArray(live.corpo), `${live.corpo?.length} jogos ao vivo das nossas ligas`);
const antigo = await get('/api/campeonatos/14/tabela');
linha('id antigo da API Futebol (14) -> 404 claro', antigo.status === 404, JSON.stringify(antigo.corpo));
const db = new DatabaseSync('data/cache.sqlite');
const legado = db.prepare("SELECT chave FROM cache WHERE chave LIKE 'partida:%' LIMIT 1").get();
if (legado) { const id = legado.chave.split(':')[1]; const r = await get(`/api/matches/${id}/summary`); linha(`partida legada numerica (${id}) ainda abre`, r.status === 200, r.corpo?.confronto ? `${r.corpo.confronto.mandante} x ${r.corpo.confronto.visitante}` : JSON.stringify(r.corpo)); }
const st = await get('/api/status');
console.log('cota hoje:', JSON.stringify(st.corpo.usoApi));
servidor.close();
process.exit(0);
