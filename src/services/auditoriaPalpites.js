// Auditoria (seção 12 da spec do motor v2): guarda cada palpite gerado pra um
// jogo AINDA NÃO disputado e, depois que o jogo termina, confere contra o
// resultado real, classificando o erro (tipo_erro) e comparando os acertos de
// "forte" vs "moderado-forte" vs "moderado".
//
// Limitação: vive no mesmo SQLite do cache (data/cache.sqlite). No Render o
// disco é efêmero, então o histórico zera a cada deploy/restart; localmente
// persiste. Se virar importante em produção, precisa de um banco externo.

import { bancoLocal as db } from '../db/cache.js';
import { buscarTodasFixtures, buscarEstatisticasFixture } from './goalApiService.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS auditoria_palpites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campeonato_id TEXT NOT NULL,
    fixture_id TEXT NOT NULL,
    confronto TEXT NOT NULL,
    mercado TEXT NOT NULL,
    direcao TEXT NOT NULL,
    linha REAL NOT NULL,
    confianca TEXT NOT NULL,
    probabilidade REAL,
    meta TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    resultado TEXT,
    valor_real REAL,
    tipo_erro TEXT,
    UNIQUE (fixture_id, mercado, direcao, linha)
  )
`);

const stmtInserir = db.prepare(
  'INSERT OR IGNORE INTO auditoria_palpites ' +
    '(campeonato_id, fixture_id, confronto, mercado, direcao, linha, confianca, probabilidade, meta, criado_em) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const stmtPendentes = db.prepare('SELECT * FROM auditoria_palpites WHERE resultado IS NULL');
const stmtResolver = db.prepare('UPDATE auditoria_palpites SET resultado = ?, valor_real = ?, tipo_erro = ? WHERE id = ?');
const stmtTodos = db.prepare('SELECT * FROM auditoria_palpites ORDER BY criado_em DESC');

// linha -1 = mercado sem linha (ambas marcam, resultado...) - o UNIQUE não
// trata NULL como igual, então usa sentinela.
export function registrarPalpites({ campeonatoId, fixtureId, confronto, palpites }) {
  const agora = Date.now();
  palpites.forEach((p) => {
    stmtInserir.run(
      String(campeonatoId), String(fixtureId), confronto, p.mercado, p.direcao,
      p.linha_sugerida ?? -1, p.confianca, p.probabilidade_estimada ?? null, JSON.stringify(p.meta), agora,
    );
  });
}

const CAMPO_STATS = {
  escanteios: ['escanteiosCasa', 'escanteiosFora'],
  cartoesAmarelos: ['cartoesCasa', 'cartoesFora'],
  finalizacoes: ['finalizacoesCasa', 'finalizacoesFora'],
  chutesNoGol: ['chutesNoGolCasa', 'chutesNoGolFora'],
  impedimentos: ['impedimentosCasa', 'impedimentosFora'],
  faltas: ['faltasCasa', 'faltasFora'],
};

// Devolve { acertou, valor } ou null quando a estatística não existe no jogo
// (aí o palpite continua pendente em vez de contar como erro).
function avaliar(meta, direcao, fixture, stats) {
  const gc = Number(fixture.homeTeamScore);
  const gf = Number(fixture.awayTeamScore);
  const passa = (valor, linha) => (direcao === 'mais de' ? valor > linha : valor < linha);

  switch (meta.tipo) {
    case 'total_gols': return { acertou: passa(gc + gf, meta.linha), valor: gc + gf };
    case 'total': {
      const [c, f] = CAMPO_STATS[meta.campo];
      if (stats?.[c] == null || stats?.[f] == null) return null;
      const total = stats[c] + stats[f];
      return { acertou: passa(total, meta.linha), valor: total };
    }
    case 'faixa_gols': return { acertou: gc + gf >= meta.min && gc + gf <= meta.max, valor: gc + gf };
    case 'ambas_marcam': {
      const ambos = gc > 0 && gf > 0;
      return { acertou: direcao === 'sim' ? ambos : !ambos, valor: ambos ? 1 : 0 };
    }
    case 'gols_time': {
      const gols = meta.lado === 'mandante' ? gc : gf;
      return { acertou: passa(gols, meta.linha), valor: gols };
    }
    case 'handicap_escanteios': {
      if (stats?.escanteiosCasa == null || stats?.escanteiosFora == null) return null;
      const saldoFav = meta.favorito === 'mandante' ? stats.escanteiosCasa - stats.escanteiosFora : stats.escanteiosFora - stats.escanteiosCasa;
      return { acertou: saldoFav > meta.linha, valor: saldoFav };
    }
    case 'vitoria': {
      const venceu = meta.lado === 'mandante' ? gc > gf : gf > gc;
      return { acertou: venceu, valor: gc - gf };
    }
    case 'dupla': {
      const naoPerdeu = meta.lado === 'mandante' ? gc >= gf : gf >= gc;
      return { acertou: naoPerdeu, valor: gc - gf };
    }
    default: return null;
  }
}

// Taxonomia simples: acerto; margem_curta (errou por até 1 unidade da linha
// - ruído, não erro de leitura); direcao_errada (errou por mais que isso).
function classificarErro(meta, acertou, valor) {
  if (acertou) return null;
  if (meta.linha != null && Math.abs(valor - meta.linha) <= 1) return 'margem_curta';
  return 'direcao_errada';
}

async function resolverPendentes() {
  const pendentes = stmtPendentes.all();
  if (pendentes.length === 0) return;

  const porCampeonato = new Map();
  for (const linha of pendentes) {
    if (!porCampeonato.has(linha.campeonato_id)) porCampeonato.set(linha.campeonato_id, await buscarTodasFixtures(linha.campeonato_id));
  }

  const statsPorJogo = new Map();
  for (const linha of pendentes) {
    const fixture = porCampeonato.get(linha.campeonato_id).find((f) => f.id === linha.fixture_id);
    if (!fixture || fixture.matchStatus !== 'FINISHED') continue;

    const meta = JSON.parse(linha.meta);
    let stats = null;
    if (meta.tipo === 'total' || meta.tipo === 'handicap_escanteios') {
      if (!statsPorJogo.has(fixture.id)) statsPorJogo.set(fixture.id, await buscarEstatisticasFixture(fixture.id, fixture.kickoffUtc).catch(() => null));
      stats = statsPorJogo.get(fixture.id);
    }
    const aval = avaliar(meta, linha.direcao, fixture, stats);
    if (!aval) continue;
    stmtResolver.run(aval.acertou ? 'acerto' : 'erro', aval.valor, classificarErro(meta, aval.acertou, aval.valor), linha.id);
  }
}

export async function relatorioAuditoria() {
  await resolverPendentes();
  const todos = stmtTodos.all();
  const resolvidos = todos.filter((l) => l.resultado);

  const porConfianca = {};
  for (const l of resolvidos) {
    const g = (porConfianca[l.confianca] ??= { total: 0, acertos: 0, erros: {} });
    g.total += 1;
    if (l.resultado === 'acerto') g.acertos += 1;
    else g.erros[l.tipo_erro] = (g.erros[l.tipo_erro] ?? 0) + 1;
  }
  Object.values(porConfianca).forEach((g) => { g.taxa_acerto = Math.round((g.acertos / g.total) * 100); });

  return {
    total_registrados: todos.length,
    resolvidos: resolvidos.length,
    pendentes: todos.length - resolvidos.length,
    por_confianca: porConfianca,
    ultimos: todos.slice(0, 30).map((l) => ({
      confronto: l.confronto, mercado: l.mercado, direcao: l.direcao, linha: l.linha === -1 ? null : l.linha,
      confianca: l.confianca, resultado: l.resultado ?? 'pendente', valor_real: l.valor_real, tipo_erro: l.tipo_erro,
    })),
    aviso: 'Histórico vive no SQLite local; no Render (disco efêmero) zera a cada deploy.',
  };
}
