const campeonatoSelect = document.getElementById('campeonato-select');
const tabelaBody = document.getElementById('tabela-body');
const aoVivoLista = document.getElementById('ao-vivo-lista');
const artilhariaLista = document.getElementById('artilharia-lista');
const modalOverlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const jogosLista = document.getElementById('jogos-lista');
const rodadaTitulo = document.getElementById('rodada-titulo');
const btnRodadaAnterior = document.getElementById('rodada-anterior');
const btnRodadaProxima = document.getElementById('rodada-proxima');
const quantidadeSelect = document.getElementById('quantidade-select');
const limiarSelect = document.getElementById('limiar-select');
const btnCalcularProvaveis = document.getElementById('btn-calcular-provaveis');
const provaveisLista = document.getElementById('provaveis-lista');
const datasPills = document.getElementById('datas-pills');

let rodadaExibida = null;

// Anima a entrada de cards/linhas conforme eles aparecem na tela ao rolar.
const revelarObserver = new IntersectionObserver((entradas) => {
  entradas.forEach((entrada) => {
    if (entrada.isIntersecting) {
      entrada.target.classList.add('visivel');
      revelarObserver.unobserve(entrada.target);
    }
  });
}, { threshold: 0.1 });

function comRevelacao(elemento) {
  elemento.classList.add('reveal');
  revelarObserver.observe(elemento);
  return elemento;
}

async function fetchJSON(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    const detalhe = corpo?.detail ?? corpo?.error ?? `HTTP ${resposta.status}`;
    const mensagem = typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe);
    if (mensagem.includes('limite diário')) {
      mostrarToast('Cota diária da API esgotada — tenta de novo mais tarde.', 'aviso');
    }
    throw new Error(mensagem);
  }
  return resposta.json();
}

// --- Toast (popup temporário no canto da tela) ---

let toastContainer = null;

function mostrarToast(mensagem, tipo = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensagem;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visivel'));

  setTimeout(() => {
    toast.classList.remove('toast-visivel');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 5000);
}

// --- Uso da cota da API (contador na topbar) ---

async function carregarUsoApi() {
  const badge = document.getElementById('uso-api-badge');
  try {
    const status = await fetchJSON('/api/status');
    const { hoje, limite } = status.usoApi;
    const pct = hoje / limite;
    badge.textContent = `${hoje}/${limite} hoje`;
    badge.classList.toggle('uso-api-aviso', pct >= 0.5 && pct < 0.9);
    badge.classList.toggle('uso-api-critico', pct >= 0.9);
  } catch {
    badge.textContent = '';
  }
}

// --- Campeonatos disponíveis (depende do plano/chave em uso) ---

async function carregarCampeonatosSelect() {
  let campeonatos;
  try {
    campeonatos = await fetchJSON('/api/campeonatos');
  } catch (err) {
    campeonatoSelect.replaceChildren();
    const option = document.createElement('option');
    option.textContent = 'Erro ao carregar campeonatos';
    campeonatoSelect.appendChild(option);
    campeonatoSelect.disabled = true;

    jogosLista.replaceChildren();
    rodadaTitulo.textContent = '';
    jogosLista.appendChild(linhaVazia(`Não foi possível carregar os campeonatos: ${err.message}`));
    return false;
  }

  campeonatoSelect.replaceChildren();

  if (campeonatos.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'Nenhum campeonato disponível no seu plano';
    campeonatoSelect.appendChild(option);
    campeonatoSelect.disabled = true;
    return false;
  }

  campeonatoSelect.disabled = false;
  campeonatos.forEach((campeonato) => {
    const option = document.createElement('option');
    option.value = campeonato.campeonato_id;
    option.textContent = campeonato.nome_popular;
    campeonatoSelect.appendChild(option);
  });
  return true;
}

// --- Tabs ---

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'jogos') carregarJogos();
    if (btn.dataset.tab === 'tabela') carregarTabela();
    if (btn.dataset.tab === 'ao-vivo') carregarAoVivo();
    if (btn.dataset.tab === 'artilharia') carregarArtilharia();
  });
});

campeonatoSelect.addEventListener('change', () => {
  rodadaExibida = null;
  carregarJogos();
  carregarTabela();
  carregarArtilharia();
});

// --- Jogos por rodada / data ---

async function carregarJogos(numeroRodada) {
  jogosLista.replaceChildren();
  rodadaTitulo.textContent = 'Carregando...';
  btnRodadaAnterior.disabled = true;
  btnRodadaProxima.disabled = true;

  const campeonatoId = campeonatoSelect.value;

  try {
    if (numeroRodada == null) {
      const campeonatos = await fetchJSON('/api/campeonatos');
      const atual = campeonatos.find((c) => String(c.campeonato_id) === campeonatoId);
      numeroRodada = atual?.rodada_atual?.rodada;
    }

    if (numeroRodada == null) {
      rodadaTitulo.textContent = '';
      jogosLista.appendChild(linhaVazia('Este campeonato é disputado em fases de mata-mata, sem rodadas sequenciais.'));
      return;
    }

    const rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numeroRodada}`);
    rodadaExibida = rodada.rodada;

    rodadaTitulo.textContent = rodada.nome;
    btnRodadaAnterior.disabled = !rodada.rodada_anterior;
    btnRodadaProxima.disabled = !rodada.proxima_rodada;

    renderJogosPorData(rodada.partidas ?? []);
  } catch (err) {
    rodadaTitulo.textContent = '';
    jogosLista.appendChild(linhaVazia(`Não foi possível carregar os jogos: ${err.message}`));
  }
}

btnRodadaAnterior.addEventListener('click', async () => {
  try {
    const campeonatoId = campeonatoSelect.value;
    const rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${rodadaExibida}`);
    if (rodada.rodada_anterior) carregarJogos(rodada.rodada_anterior.rodada);
  } catch (err) {
    jogosLista.appendChild(linhaVazia(`Não foi possível trocar de rodada: ${err.message}`));
  }
});

btnRodadaProxima.addEventListener('click', async () => {
  try {
    const campeonatoId = campeonatoSelect.value;
    const rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${rodadaExibida}`);
    if (rodada.proxima_rodada) carregarJogos(rodada.proxima_rodada.rodada);
  } catch (err) {
    jogosLista.appendChild(linhaVazia(`Não foi possível trocar de rodada: ${err.message}`));
  }
});

function formatarData(dataIso) {
  const data = new Date(dataIso);
  const texto = data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  return texto.charAt(0).toUpperCase() + texto.slice(1).replace('.', '');
}

// "Hoje" / "Amanhã" / "Em N dias" - igual ao formato de sites de aposta,
// calculado a partir da diferença de dias corridos até a data do jogo.
function formatarRotuloPill(dataIso) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const data = new Date(dataIso);
  data.setHours(0, 0, 0, 0);
  const diffDias = Math.round((data - hoje) / 86400000);

  if (diffDias === 0) return 'Hoje';
  if (diffDias === 1) return 'Amanhã';
  if (diffDias === -1) return 'Ontem';
  if (diffDias > 1) return `Em ${diffDias} dias`;
  return `${Math.abs(diffDias)} dias atrás`;
}

function formatarDataCurta(dataIso) {
  return new Date(dataIso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function situacaoJogo(partida) {
  if (partida.status === 'andamento') {
    return { texto: `${partida.cronometro}'`, classe: 'andamento' };
  }
  if (partida.status === 'finalizado' || partida.status === 'encerrada') {
    return { texto: partida.placar_mandante + ' x ' + partida.placar_visitante, classe: 'encerrada' };
  }
  return { texto: 'AGENDADA', classe: '' };
}

function renderJogosPorData(partidas) {
  jogosLista.replaceChildren();
  datasPills.replaceChildren();

  if (partidas.length === 0) {
    jogosLista.appendChild(linhaVazia('Sem jogos cadastrados nesta rodada.'));
    return;
  }

  const grupos = new Map();
  partidas.forEach((partida) => {
    const chave = partida.data_realizacao;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(partida);
  });

  let primeiroGrupoId = null;

  grupos.forEach((jogosDoDia, dataChave) => {
    const dataIso = jogosDoDia[0].data_realizacao_iso ?? dataChave;
    const idGrupo = `data-grupo-${dataChave.replace(/\D/g, '')}`;
    if (!primeiroGrupoId) primeiroGrupoId = idGrupo;

    const grupo = document.createElement('div');
    grupo.className = 'data-grupo';
    grupo.id = idGrupo;

    const cabecalho = document.createElement('div');
    cabecalho.className = 'data-cabecalho';
    cabecalho.textContent = formatarData(dataIso);
    grupo.appendChild(cabecalho);

    jogosDoDia.forEach((partida) => {
      grupo.appendChild(criarLinhaJogo(partida));
    });

    jogosLista.appendChild(grupo);

    const pill = document.createElement('button');
    pill.className = 'data-pill';
    pill.dataset.alvo = idGrupo;
    const rotulo = document.createElement('div');
    rotulo.className = 'pill-rotulo';
    rotulo.textContent = formatarRotuloPill(dataIso);
    const subrotulo = document.createElement('div');
    subrotulo.className = 'pill-data';
    subrotulo.textContent = formatarDataCurta(dataIso);
    pill.append(rotulo, subrotulo);
    pill.addEventListener('click', () => {
      document.getElementById(idGrupo).scrollIntoView({ behavior: 'smooth', block: 'start' });
      datasPills.querySelectorAll('.data-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
    });
    datasPills.appendChild(pill);
  });

  if (primeiroGrupoId) {
    datasPills.querySelector(`[data-alvo="${primeiroGrupoId}"]`)?.classList.add('active');
  }
}

function criarLinhaJogo(partida) {
  const linha = document.createElement('div');
  linha.className = 'jogo-linha';
  comRevelacao(linha);
  linha.addEventListener('click', () => {
    if (partida.status === 'agendado') {
      abrirFormaPreJogo(partida);
    } else {
      abrirResumo(partida.partida_id);
    }
  });

  const horario = document.createElement('span');
  horario.className = 'horario';
  horario.textContent = partida.hora_realizacao ?? '';

  const confrontos = document.createElement('div');
  confrontos.className = 'confrontos';
  confrontos.appendChild(timeLinhaJogos(partida.time_mandante));
  confrontos.appendChild(timeLinhaJogos(partida.time_visitante));

  const situacao = situacaoJogo(partida);
  const situacaoEl = document.createElement('span');
  situacaoEl.className = `situacao ${situacao.classe}`;
  situacaoEl.textContent = situacao.texto;

  linha.append(horario, confrontos, situacaoEl);
  return linha;
}

function timeLinhaJogos(time) {
  const linha = document.createElement('div');
  linha.className = 'time-linha';
  const img = document.createElement('img');
  img.src = time.escudo;
  img.alt = '';
  const nome = document.createElement('span');
  nome.textContent = time.nome_popular;
  linha.append(img, nome);
  return linha;
}

// --- Prováveis: ranking de jogos agendados por confiança do modelo ---

const NOMES_RESULTADO = { mandante: 'vence', empate: 'empate', visitante: 'vence' };

btnCalcularProvaveis.addEventListener('click', calcularProvaveis);

async function calcularProvaveis() {
  const campeonatoId = campeonatoSelect.value;
  const quantidade = quantidadeSelect.value;
  const limiar = Number(limiarSelect.value);

  btnCalcularProvaveis.disabled = true;
  btnCalcularProvaveis.textContent = 'Calculando...';
  provaveisLista.replaceChildren();

  try {
    const campeonatos = await fetchJSON('/api/campeonatos');
    const infoCampeonato = campeonatos.find((c) => String(c.campeonato_id) === campeonatoId);
    const numeroRodada = infoCampeonato?.rodada_atual?.rodada;

    if (numeroRodada == null) {
      provaveisLista.appendChild(linhaVazia('Este campeonato não tem rodadas sequenciais pra calcular.'));
      return;
    }

    const rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numeroRodada}`);
    const agendados = (rodada.partidas ?? []).filter((p) => p.status === 'agendado');

    if (agendados.length === 0) {
      provaveisLista.appendChild(linhaVazia('Nenhum jogo agendado nesta rodada no momento.'));
      return;
    }

    // Promise.allSettled (não Promise.all): um jogo sem cache disponível não
    // pode derrubar o cálculo dos outros que já tinham dado certo.
    let falhas = 0;
    const settled = await Promise.allSettled(
      agendados.map(async (partida) => {
        const [formaMandante, formaVisitante] = await Promise.all([
          fetchJSON(`/api/times/${partida.time_mandante.time_id}/forma?campeonato=${campeonatoId}&antes=${numeroRodada}&quantidade=${quantidade}`),
          fetchJSON(`/api/times/${partida.time_visitante.time_id}/forma?campeonato=${campeonatoId}&antes=${numeroRodada}&quantidade=${quantidade}`),
        ]);
        if (!formaMandante.medias || !formaVisitante.medias) return null;

        const est = estimarProbabilidades(formaMandante.medias, formaVisitante.medias);
        const opcoes = [
          { lado: 'mandante', pct: est.vitoriaMandante, nome: partida.time_mandante.nome_popular },
          { lado: 'empate', pct: est.empate, nome: 'Empate' },
          { lado: 'visitante', pct: est.vitoriaVisitante, nome: partida.time_visitante.nome_popular },
        ];
        const favorito = opcoes.reduce((a, b) => (b.pct > a.pct ? b : a));

        return { partida, favorito };
      }),
    );

    const resultados = settled.map((s) => {
      if (s.status === 'rejected') {
        falhas += 1;
        return null;
      }
      return s.value;
    });

    const filtrados = resultados
      .filter((r) => r && r.favorito.pct >= limiar)
      .sort((a, b) => b.favorito.pct - a.favorito.pct)
      .slice(0, 10);

    renderProvaveis(filtrados, falhas);
  } catch (err) {
    provaveisLista.appendChild(linhaVazia(`Não foi possível calcular: ${err.message}`));
  } finally {
    btnCalcularProvaveis.disabled = false;
    btnCalcularProvaveis.textContent = 'Calcular jogos prováveis desta rodada';
  }
}

function renderProvaveis(itens, falhas = 0) {
  provaveisLista.replaceChildren();

  if (falhas > 0) {
    const aviso = falhas === 1 ? '1 jogo não pôde ser calculado agora (sem dados em cache) e ficou de fora.' : `${falhas} jogos não puderam ser calculados agora (sem dados em cache) e ficaram de fora.`;
    provaveisLista.appendChild(linhaVazia(aviso));
  }

  if (itens.length === 0) {
    provaveisLista.appendChild(linhaVazia('Nenhum jogo bateu o limiar escolhido nesta rodada. Tenta um percentual menor.'));
    return;
  }

  const lista = document.createElement('ol');
  lista.className = 'provaveis-ranking';

  itens.forEach(({ partida, favorito }) => {
    const li = document.createElement('li');
    li.className = 'provavel-item';
    li.addEventListener('click', () => abrirFormaPreJogo(partida));

    const cabecalho = document.createElement('div');
    cabecalho.className = 'provavel-cabecalho';
    cabecalho.appendChild(el2('span', 'provavel-confronto', `${partida.time_mandante.nome_popular} x ${partida.time_visitante.nome_popular}`));
    cabecalho.appendChild(el2('span', 'provavel-percentual', `${favorito.pct}%`));
    li.appendChild(cabecalho);

    const texto = favorito.lado === 'empate' ? 'Empate' : `${favorito.nome} ${NOMES_RESULTADO[favorito.lado]}`;
    li.appendChild(el2('div', 'provavel-detalhe', `${texto} · ${partida.hora_realizacao ?? ''}`));

    lista.appendChild(li);
  });

  provaveisLista.appendChild(lista);
}

function el2(tag, cls, texto) {
  const elemento = document.createElement(tag);
  elemento.className = cls;
  elemento.textContent = texto;
  return elemento;
}

// --- Tabela ---

async function carregarTabela() {
  tabelaBody.replaceChildren();
  const campeonatoId = campeonatoSelect.value;

  let linhas;
  try {
    linhas = await fetchJSON(`/api/campeonatos/${campeonatoId}/tabela`);
  } catch (err) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.className = 'vazio';
    td.textContent = `Não foi possível carregar a tabela: ${err.message}`;
    tr.appendChild(td);
    tabelaBody.appendChild(tr);
    return;
  }

  linhas.forEach((linha) => {
    const tr = document.createElement('tr');
    tr.className = linha.faixa_classificacao ?? '';
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => abrirPerfilTime(linha));

    tr.appendChild(celula(linha.posicao));

    const tdTime = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'time-cell';
    const img = document.createElement('img');
    img.src = linha.time.escudo;
    img.alt = '';
    const nome = document.createElement('span');
    nome.textContent = linha.time.nome_popular;
    wrap.append(img, nome);
    tdTime.appendChild(wrap);
    tr.appendChild(tdTime);

    tr.appendChild(celula(linha.pontos));
    tr.appendChild(celula(linha.jogos));
    tr.appendChild(celula(linha.vitorias));
    tr.appendChild(celula(linha.empates));
    tr.appendChild(celula(linha.derrotas));
    tr.appendChild(celula(linha.saldo_gols));

    tabelaBody.appendChild(comRevelacao(tr));
  });
}

function celula(valor) {
  const td = document.createElement('td');
  td.textContent = valor;
  return td;
}

// --- Ao vivo ---

async function carregarAoVivo() {
  aoVivoLista.replaceChildren();

  let partidas;
  try {
    partidas = await fetchJSON('/api/matches/live');
  } catch (err) {
    aoVivoLista.appendChild(linhaVazia(`Não foi possível carregar os jogos ao vivo: ${err.message}`));
    return;
  }

  if (partidas.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'vazio';
    vazio.textContent = 'Nenhuma partida ao vivo neste momento.';
    aoVivoLista.appendChild(vazio);
    return;
  }

  partidas.forEach((partida) => {
    aoVivoLista.appendChild(comRevelacao(criarCardJogo(partida)));
  });
}

function statusLabel(partida) {
  if (partida.status === 'andamento') {
    const periodo = (partida.periodo ?? '').replace(/-/g, ' ');
    return `${periodo} · ${partida.cronometro}'`.toUpperCase();
  }
  return (partida.status ?? '').toUpperCase();
}

function criarCardJogo(partida) {
  const card = document.createElement('div');
  card.className = 'jogo-card';
  card.addEventListener('click', () => abrirResumo(partida.partida_id));

  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = statusLabel(partida);
  card.appendChild(status);

  card.appendChild(linhaTime(partida.time_mandante, partida.placar_mandante));
  card.appendChild(linhaTime(partida.time_visitante, partida.placar_visitante));

  const estadio = document.createElement('div');
  estadio.className = 'estadio';
  estadio.textContent = partida.estadio?.nome_popular ?? '';
  card.appendChild(estadio);

  return card;
}

function linhaTime(time, placar) {
  const linha = document.createElement('div');
  linha.className = 'confronto-linha';

  const img = document.createElement('img');
  img.src = time.escudo;
  img.alt = '';

  const nome = document.createElement('span');
  nome.className = 'nome';
  nome.textContent = time.nome_popular;

  const placarEl = document.createElement('span');
  placarEl.className = 'placar';
  placarEl.textContent = placar;

  linha.append(img, nome, placarEl);
  return linha;
}

// --- Artilharia ---

async function carregarArtilharia() {
  artilhariaLista.replaceChildren();
  const campeonatoId = campeonatoSelect.value;

  let artilheiros;
  try {
    artilheiros = await fetchJSON(`/api/campeonatos/${campeonatoId}/artilharia`);
  } catch (err) {
    artilhariaLista.appendChild(linhaVazia(`Não foi possível carregar a artilharia: ${err.message}`));
    return;
  }

  artilheiros.forEach((item) => {
    const li = document.createElement('li');

    const img = document.createElement('img');
    img.src = item.time.escudo;
    img.alt = '';

    const nome = document.createElement('span');
    nome.className = 'nome';
    nome.textContent = `${item.atleta.nome_popular} — ${item.time.nome_popular}`;

    const gols = document.createElement('span');
    gols.className = 'gols';
    gols.textContent = `${item.gols} gols`;

    li.append(img, nome, gols);
    artilhariaLista.appendChild(comRevelacao(li));
  });
}

// --- Modal de forma recente (pré-jogo, para partidas ainda não realizadas) ---

const FAIXA_LABELS = {
  rebaixados: 'Rebaixamento',
  libertadores: 'Libertadores',
  'pre-libertadores': 'Pré-Libertadores',
  'sul-americana': 'Sul-Americana',
  'acesso-serie-a': 'Acesso à Série A',
  'playoffs-de-acesso': 'Playoff de acesso',
  'rebaixados-serie-c': 'Rebaixamento',
};

async function abrirFormaPreJogo(partida) {
  modalContent.replaceChildren();
  modalOverlay.classList.add('active');

  const campeonatoId = campeonatoSelect.value;
  const antes = rodadaExibida;
  const quantidade = quantidadeSelect.value;

  const cabecalho = document.createElement('div');
  cabecalho.className = 'resumo-placar';
  const times = document.createElement('div');
  times.className = 'times';
  times.textContent = `${partida.time_mandante.nome_popular} x ${partida.time_visitante.nome_popular}`;
  const subtitulo = document.createElement('div');
  subtitulo.className = 'forma-subtitulo';
  subtitulo.textContent = `Últimos ${quantidade} jogos`;
  cabecalho.append(times, subtitulo);
  modalContent.appendChild(cabecalho);

  let formaMandante;
  let formaVisitante;
  let tabela;
  try {
    [formaMandante, formaVisitante, tabela] = await Promise.all([
      fetchJSON(`/api/times/${partida.time_mandante.time_id}/forma?campeonato=${campeonatoId}&antes=${antes}&quantidade=${quantidade}`),
      fetchJSON(`/api/times/${partida.time_visitante.time_id}/forma?campeonato=${campeonatoId}&antes=${antes}&quantidade=${quantidade}`),
      fetchJSON(`/api/campeonatos/${campeonatoId}/tabela`),
    ]);
  } catch (err) {
    modalContent.appendChild(linhaVazia(`Não foi possível carregar o comparativo: ${err.message}`));
    return;
  }

  const linhaMandante = tabela.find((l) => l.time.time_id === partida.time_mandante.time_id);
  const linhaVisitante = tabela.find((l) => l.time.time_id === partida.time_visitante.time_id);

  const tagsRow = document.createElement('div');
  tagsRow.className = 'forma-tags-linha';
  tagsRow.appendChild(tagContexto(linhaMandante, formaMandante.medias));
  tagsRow.appendChild(tagContexto(linhaVisitante, formaVisitante.medias));
  modalContent.appendChild(tagsRow);

  modalContent.appendChild(linhaResultados(partida.time_mandante.nome_popular, formaMandante.jogos));
  modalContent.appendChild(linhaResultados(partida.time_visitante.nome_popular, formaVisitante.jogos));

  if (!formaMandante.medias || !formaVisitante.medias) {
    modalContent.appendChild(linhaVazia('Sem jogos anteriores suficientes para montar o comparativo.'));
    return;
  }

  modalContent.appendChild(
    secaoDetalheTimes(
      [
        { nome: partida.time_mandante.nome_popular, forma: formaMandante },
        { nome: partida.time_visitante.nome_popular, forma: formaVisitante },
      ],
    ),
  );

  modalContent.appendChild(
    secaoProbabilidade(partida.time_mandante.nome_popular, partida.time_visitante.nome_popular, formaMandante.medias, formaVisitante.medias),
  );
}

// Abas pra escolher um dos dois times e ver o perfil individual dele
// (médias, top 5, chances) sem sair do comparativo do jogo.
function secaoDetalheTimes(times) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'stats-tabs';

  const corpo = document.createElement('div');

  function renderCorpo(indice) {
    corpo.replaceChildren();
    const { forma } = times[indice];
    corpo.appendChild(secaoMediasIndividuais(forma.medias));
    corpo.appendChild(secaoTop5(forma.jogos));
    corpo.appendChild(secaoAlertas(forma.jogos, forma.medias));
  }

  times.forEach((time, indice) => {
    const btn = document.createElement('button');
    btn.className = 'stats-tab-btn' + (indice === 0 ? ' active' : '');
    btn.textContent = time.nome;
    btn.addEventListener('click', () => {
      tabsWrap.querySelectorAll('.stats-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderCorpo(indice);
    });
    tabsWrap.appendChild(btn);
  });

  renderCorpo(0);
  secao.append(tabsWrap, corpo);
  return secao;
}

// Sinais curtos de estilo de jogo, derivados das médias reais — sem prosa,
// só os 2 traços mais fora da média (limiares fixos, mesmos de antes).
function sinaisPerfil(medias) {
  const sinais = [];
  const push = (condicao, texto, prioridade) => {
    if (condicao) sinais.push({ texto, prioridade });
  };

  push(medias.mediaFinalizacoes >= 13, 'Ataque volumoso', Math.abs(medias.mediaFinalizacoes - 11));
  push(medias.mediaFinalizacoes <= 8, 'Pouco ofensivo', Math.abs(medias.mediaFinalizacoes - 11));
  push(medias.mediaPosseDeBola >= 55, 'Domina a posse', Math.abs(medias.mediaPosseDeBola - 50));
  push(medias.mediaPosseDeBola <= 45, 'Contra-ataque', Math.abs(medias.mediaPosseDeBola - 50));
  push(medias.mediaFaltas >= 14, 'Jogo físico', Math.abs(medias.mediaFaltas - 11));
  push(medias.mediaFaltas <= 8, 'Poucas faltas', Math.abs(medias.mediaFaltas - 11));
  push(medias.mediaChutesNoGol >= 6, 'Finalização certeira', Math.abs(medias.mediaChutesNoGol - 4));
  push(medias.mediaChutesNoGol <= 3, 'Pouco incisivo', Math.abs(medias.mediaChutesNoGol - 4));

  return sinais
    .sort((a, b) => b.prioridade - a.prioridade)
    .slice(0, 2)
    .map((s) => s.texto);
}

function tagContexto(linhaTabela, medias) {
  const tag = document.createElement('div');
  tag.className = 'forma-tag';

  if (!linhaTabela && !medias) {
    tag.textContent = '—';
    return tag;
  }

  if (linhaTabela) {
    const posicao = document.createElement('span');
    posicao.className = 'forma-tag-posicao';
    posicao.textContent = `${linhaTabela.posicao}º · ${linhaTabela.pontos} pts`;
    tag.appendChild(posicao);

    const zona = FAIXA_LABELS[linhaTabela.faixa_classificacao];
    if (zona) {
      const selo = document.createElement('span');
      selo.className = `forma-tag-selo ${linhaTabela.faixa_classificacao}`;
      selo.textContent = zona;
      tag.appendChild(selo);
    }
  }

  if (medias) {
    sinaisPerfil(medias).forEach((texto) => {
      const chip = document.createElement('span');
      chip.className = 'forma-tag-chip';
      chip.textContent = texto;
      tag.appendChild(chip);
    });
  }

  return tag;
}

function linhaResultados(nomeTime, jogos) {
  const linha = document.createElement('div');
  linha.className = 'forma-resultados-linha';

  const nome = document.createElement('span');
  nome.className = 'forma-resultados-nome';
  nome.textContent = nomeTime;
  linha.appendChild(nome);

  const badges = document.createElement('div');
  badges.className = 'forma-resultados';
  [...jogos].reverse().forEach((jogo) => {
    const badge = document.createElement('span');
    badge.className = `resultado-badge ${jogo.resultado}`;
    badge.textContent = jogo.resultado;
    badge.title = `${jogo.mandante ? 'vs' : '@'} ${jogo.adversario} — ${jogo.placar}`;
    badges.appendChild(badge);
  });
  linha.appendChild(badges);

  return linha;
}

const LINHAS_COMPARATIVO = [
  ['Aproveitamento', 'aproveitamento', '%'],
  ['Gols marcados', 'mediaGolsPro', ''],
  ['Gols sofridos', 'mediaGolsContra', ''],
  ['Finalizações', 'mediaFinalizacoes', ''],
  ['Chutes no gol', 'mediaChutesNoGol', ''],
  ['Escanteios', 'mediaEscanteios', ''],
  ['Impedimentos', 'mediaImpedimentos', ''],
  ['Faltas cometidas', 'mediaFaltas', ''],
  ['Cartões amarelos', 'mediaCartoesAmarelos', ''],
];

// --- Estimativa estatística (modelo de Poisson simplificado) ---
//
// Técnica clássica de análise esportiva: usa a média de gols marcados de um
// time e a média de gols sofridos do adversário pra estimar um "gols esperados"
// (xG simplificado), e a distribuição de Poisson pra transformar isso numa
// probabilidade de vitória/empate/derrota. É um modelo real e transparente,
// mas continua sendo uma ESTIMATIVA a partir de poucos jogos — não uma garantia.

function fatorial(n) {
  let resultado = 1;
  for (let i = 2; i <= n; i++) resultado *= i;
  return resultado;
}

function poisson(lambda, k) {
  return (Math.exp(-lambda) * lambda ** k) / fatorial(k);
}

function estimarProbabilidades(mediasMandante, mediasVisitante) {
  const xgMandante = (mediasMandante.mediaGolsPro + mediasVisitante.mediaGolsContra) / 2;
  const xgVisitante = (mediasVisitante.mediaGolsPro + mediasMandante.mediaGolsContra) / 2;

  let vitoriaMandante = 0;
  let empate = 0;
  let vitoriaVisitante = 0;

  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const probabilidade = poisson(xgMandante, i) * poisson(xgVisitante, j);
      if (i > j) vitoriaMandante += probabilidade;
      else if (i === j) empate += probabilidade;
      else vitoriaVisitante += probabilidade;
    }
  }

  const total = vitoriaMandante + empate + vitoriaVisitante;
  const valores = [
    Math.round((vitoriaMandante / total) * 100),
    Math.round((empate / total) * 100),
    Math.round((vitoriaVisitante / total) * 100),
  ];

  // Ajusta o arredondamento pra somar exatamente 100%.
  const diferenca = 100 - (valores[0] + valores[1] + valores[2]);
  valores[valores.indexOf(Math.max(...valores))] += diferenca;

  return {
    vitoriaMandante: valores[0],
    empate: valores[1],
    vitoriaVisitante: valores[2],
    xgMandante: Math.round(xgMandante * 10) / 10,
    xgVisitante: Math.round(xgVisitante * 10) / 10,
  };
}

function secaoProbabilidade(nomeMandante, nomeVisitante, mediasMandante, mediasVisitante) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';

  const titulo = document.createElement('h3');
  titulo.textContent = 'Estimativa estatística';
  secao.appendChild(titulo);

  const estimativa = estimarProbabilidades(mediasMandante, mediasVisitante);

  const card = document.createElement('div');
  card.className = 'prob-card';

  const barra = document.createElement('div');
  barra.className = 'prob-bar';
  barra.appendChild(criarSegmentoProb('mandante', estimativa.vitoriaMandante));
  barra.appendChild(criarSegmentoProb('empate', estimativa.empate));
  barra.appendChild(criarSegmentoProb('visitante', estimativa.vitoriaVisitante));
  card.appendChild(barra);

  const legenda = document.createElement('div');
  legenda.className = 'prob-legenda';
  [
    ['mandante', nomeMandante],
    ['empate', 'Empate'],
    ['visitante', nomeVisitante],
  ].forEach(([tipo, nome]) => {
    const item = document.createElement('span');
    item.className = 'prob-legenda-item';
    const bolinha = document.createElement('span');
    bolinha.className = `prob-dot prob-dot-${tipo}`;
    item.append(bolinha, document.createTextNode(nome));
    legenda.appendChild(item);
  });
  card.appendChild(legenda);

  const nota = document.createElement('p');
  nota.className = 'prob-nota';
  nota.textContent =
    `Modelo Poisson a partir da média de gols pró/contra dos últimos jogos ` +
    `(gols esperados: ${nomeMandante} ${estimativa.xgMandante} x ${estimativa.xgVisitante} ${nomeVisitante}).`;
  card.appendChild(nota);

  secao.appendChild(card);
  return secao;
}

function criarSegmentoProb(tipo, valor) {
  const seg = document.createElement('div');
  seg.className = `prob-seg prob-seg-${tipo}`;
  seg.style.width = `${valor}%`;
  seg.textContent = `${valor}%`;
  return seg;
}

// --- Modal de perfil do time (histórico + top 5 + próximo jogo) ---

async function abrirPerfilTime(linhaTabela) {
  modalContent.replaceChildren();
  modalOverlay.classList.add('active');

  const campeonatoId = campeonatoSelect.value;
  const quantidade = quantidadeSelect.value;
  const time = linhaTabela.time;

  const cabecalho = document.createElement('div');
  cabecalho.className = 'resumo-placar';
  const nomeEl = document.createElement('div');
  nomeEl.className = 'times';
  nomeEl.textContent = time.nome_popular;
  const subtitulo = document.createElement('div');
  subtitulo.className = 'forma-subtitulo';
  subtitulo.textContent = `Histórico dos últimos ${quantidade} jogos`;
  cabecalho.append(nomeEl, subtitulo);
  modalContent.appendChild(cabecalho);

  const tagsRow = document.createElement('div');
  tagsRow.className = 'forma-tags-linha';
  modalContent.appendChild(tagsRow);

  let forma;
  let numeroRodadaAtual;
  try {
    const campeonatos = await fetchJSON('/api/campeonatos');
    const infoCampeonato = campeonatos.find((c) => String(c.campeonato_id) === campeonatoId);
    numeroRodadaAtual = infoCampeonato?.rodada_atual?.rodada;

    forma = await fetchJSON(
      `/api/times/${time.time_id}/forma?campeonato=${campeonatoId}&antes=${numeroRodadaAtual}&quantidade=${quantidade}`,
    );
  } catch (err) {
    modalContent.appendChild(linhaVazia(`Não foi possível carregar o histórico do time: ${err.message}`));
    return;
  }

  tagsRow.appendChild(tagContexto(linhaTabela, forma.medias));

  modalContent.appendChild(linhaResultados(time.nome_popular, forma.jogos));

  if (!forma.medias) {
    modalContent.appendChild(linhaVazia('Sem jogos anteriores suficientes para montar o histórico.'));
    return;
  }

  modalContent.appendChild(secaoMediasIndividuais(forma.medias));
  modalContent.appendChild(secaoTop5(forma.jogos));
  modalContent.appendChild(secaoAlertas(forma.jogos, forma.medias));

  try {
    const proximoJogo = await buscarProximoJogo(campeonatoId, numeroRodadaAtual, time.time_id);
    if (proximoJogo) {
      modalContent.appendChild(await secaoProximoJogo(campeonatoId, quantidade, numeroRodadaAtual, time, proximoJogo));
    }
  } catch (err) {
    modalContent.appendChild(linhaVazia(`Não foi possível carregar o próximo jogo: ${err.message}`));
  }
}

async function buscarProximoJogo(campeonatoId, numeroRodada, timeId) {
  if (numeroRodada == null) return null;
  const rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numeroRodada}`);
  return (rodada.partidas ?? []).find(
    (p) => p.status === 'agendado' && (p.time_mandante.time_id === timeId || p.time_visitante.time_id === timeId),
  );
}

async function secaoProximoJogo(campeonatoId, quantidade, antesRodada, time, partida) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Próximo jogo';
  secao.appendChild(titulo);

  const linha = document.createElement('div');
  linha.className = 'forma-resultados-linha';
  const nomeConfronto = document.createElement('span');
  nomeConfronto.className = 'forma-resultados-nome';
  nomeConfronto.textContent = `${partida.time_mandante.nome_popular} x ${partida.time_visitante.nome_popular}`;
  linha.appendChild(nomeConfronto);
  secao.appendChild(linha);

  const adversarioId =
    partida.time_mandante.time_id === time.time_id ? partida.time_visitante.time_id : partida.time_mandante.time_id;

  const formaAdversario = await fetchJSON(
    `/api/times/${adversarioId}/forma?campeonato=${campeonatoId}&antes=${antesRodada}&quantidade=${quantidade}`,
  );

  const formaTime = await fetchJSON(
    `/api/times/${time.time_id}/forma?campeonato=${campeonatoId}&antes=${antesRodada}&quantidade=${quantidade}`,
  );

  if (!formaTime.medias || !formaAdversario.medias) {
    secao.appendChild(linhaVazia('Sem dados suficientes do adversário para estimar.'));
    return secao;
  }

  const ehMandante = partida.time_mandante.time_id === time.time_id;
  const mediasMandante = ehMandante ? formaTime.medias : formaAdversario.medias;
  const mediasVisitante = ehMandante ? formaAdversario.medias : formaTime.medias;

  secao.appendChild(
    secaoProbabilidade(partida.time_mandante.nome_popular, partida.time_visitante.nome_popular, mediasMandante, mediasVisitante),
  );

  return secao;
}

function secaoMediasIndividuais(medias) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Médias no período';
  secao.appendChild(titulo);

  const card = document.createElement('div');
  card.className = 'info-card';
  LINHAS_COMPARATIVO.forEach(([label, campo, sufixo]) => {
    const row = document.createElement('div');
    row.className = 'info-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    const valorEl = document.createElement('span');
    valorEl.className = 'valor';
    valorEl.textContent = `${medias[campo]}${sufixo}`;
    row.append(labelEl, valorEl);
    card.appendChild(row);
  });
  secao.appendChild(card);

  return secao;
}

const TOP5_CATEGORIAS = [
  ['Chutes no gol', 'chutesNoGol'],
  ['Gols marcados', 'golsPro'],
  ['Faltas cometidas', 'faltas'],
  ['Escanteios', 'escanteios'],
  ['Cartões amarelos', 'cartoesAmarelos'],
];

// <details> nativo: expande/recolhe sem JS extra. Fica fechado por padrão
// pra quem quiser pular direto pras Chances, mas continua ali se quiser abrir.
function secaoTop5(jogos) {
  const secao = document.createElement('details');
  secao.className = 'resumo-secao top5-detalhes';

  const sumario = document.createElement('summary');
  sumario.className = 'top5-sumario';
  sumario.textContent = 'Top 5 atuações (no período)';
  secao.appendChild(sumario);

  const corpo = document.createElement('div');
  corpo.className = 'top5-corpo';

  TOP5_CATEGORIAS.forEach(([label, campo]) => {
    const bloco = document.createElement('div');
    bloco.className = 'top5-bloco';

    const rotulo = document.createElement('div');
    rotulo.className = 'top5-rotulo';
    rotulo.textContent = label;
    bloco.appendChild(rotulo);

    const lista = document.createElement('ol');
    lista.className = 'top5-lista';
    [...jogos]
      .sort((a, b) => b[campo] - a[campo])
      .slice(0, 5)
      .forEach((jogo) => {
        const item = document.createElement('li');
        const adversario = document.createElement('span');
        adversario.textContent = `${jogo.mandante ? 'vs' : '@'} ${jogo.adversario}`;
        const valor = document.createElement('span');
        valor.className = 'top5-valor';
        valor.textContent = jogo[campo];
        item.append(adversario, valor);
        lista.appendChild(item);
      });
    bloco.appendChild(lista);
    corpo.appendChild(bloco);
  });

  secao.appendChild(corpo);
  return secao;
}

// "Chances" por estatística: frequência histórica de cada uma passar de uma
// linha derivada da própria média (arredondada pra baixo + 0.5, o formato
// "X.5" comum em mercados de over/under). É contagem simples sobre os jogos
// já carregados - nada de distribuição estatística projetada, só o que
// realmente aconteceu nos últimos jogos.
const ALERTA_CATEGORIAS = [
  ['Escanteios', 'escanteios', 'mediaEscanteios', ''],
  ['Chutes no gol', 'chutesNoGol', 'mediaChutesNoGol', ''],
  ['Finalizações', 'finalizacoes', 'mediaFinalizacoes', ''],
  ['Faltas cometidas', 'faltas', 'mediaFaltas', ''],
  ['Cartões amarelos', 'cartoesAmarelos', 'mediaCartoesAmarelos', ''],
  ['Impedimentos', 'impedimentos', 'mediaImpedimentos', ''],
  ['Gols marcados', 'golsPro', 'mediaGolsPro', ''],
  ['Gols sofridos', 'golsContra', 'mediaGolsContra', ''],
  ['Posse de bola', 'posseDeBola', 'mediaPosseDeBola', '%'],
];

function calcularAlertas(jogos, medias) {
  return ALERTA_CATEGORIAS.map(([label, campo, campoMedia, sufixo]) => {
    const linha = Math.floor(medias[campoMedia]) + 0.5;
    const acima = jogos.filter((jogo) => jogo[campo] > linha).length;
    const percentual = Math.round((acima / jogos.length) * 100);
    return { label, linha, percentual, sufixo };
  });
}

function secaoAlertas(jogos, medias) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Chances (com base nos últimos jogos)';
  secao.appendChild(titulo);

  const lista = document.createElement('div');
  lista.className = 'alertas-lista';
  calcularAlertas(jogos, medias).forEach(({ label, linha, percentual, sufixo }) => {
    const chip = document.createElement('div');
    chip.className = 'alerta-chip';
    const texto = document.createElement('span');
    texto.textContent = `${label} > ${linha}${sufixo}`;
    const valor = document.createElement('span');
    valor.className = 'alerta-percentual';
    valor.textContent = `${percentual}%`;
    chip.append(texto, valor);
    lista.appendChild(chip);
  });
  secao.appendChild(lista);

  const nota = document.createElement('p');
  nota.className = 'prob-nota';
  nota.textContent = `Frequência nos últimos ${jogos.length} jogos.`;
  secao.appendChild(nota);

  return secao;
}

// --- Modal de resumo ---

async function abrirResumo(partidaId) {
  modalContent.replaceChildren();
  modalOverlay.classList.add('active');

  const resumo = await fetchJSON(`/api/matches/${partidaId}/summary`);

  const placarBloco = document.createElement('div');
  placarBloco.className = 'resumo-placar';
  const times = document.createElement('div');
  times.className = 'times';
  times.textContent = `${resumo.confronto.mandante} x ${resumo.confronto.visitante}`;
  const placarGrande = document.createElement('div');
  placarGrande.className = 'placar-grande';
  placarGrande.textContent = resumo.confronto.placar;
  placarBloco.append(times, placarGrande);
  modalContent.appendChild(placarBloco);

  modalContent.appendChild(secaoInformacoes(resumo));
  modalContent.appendChild(secaoGols(resumo.gols));
  modalContent.appendChild(secaoCartoes(resumo.cartoes));
  modalContent.appendChild(secaoEstatisticas(resumo.estatisticas, resumo.confronto.mandante, resumo.confronto.visitante));
}

function secaoInformacoes(resumo) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Informações sobre a partida';
  secao.appendChild(titulo);

  const card = document.createElement('div');
  card.className = 'info-card';

  const tecnicoMandante = resumo.escalacoes?.mandante?.tecnico?.nome_popular;
  const tecnicoVisitante = resumo.escalacoes?.visitante?.tecnico?.nome_popular;

  const linhas = [
    ['Competição', resumo.partida.campeonato ?? '—'],
    ['Estádio', resumo.partida.estadio ?? '—'],
    ['Rodada', resumo.partida.rodada ?? '—'],
    [`Técnico ${resumo.confronto.mandante}`, tecnicoMandante ?? '—'],
    [`Técnico ${resumo.confronto.visitante}`, tecnicoVisitante ?? '—'],
  ];

  linhas.forEach(([label, valor]) => {
    const row = document.createElement('div');
    row.className = 'info-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    const valorEl = document.createElement('span');
    valorEl.className = 'valor';
    valorEl.textContent = valor;
    row.append(labelEl, valorEl);
    card.appendChild(row);
  });

  secao.appendChild(card);
  return secao;
}

function secaoGols(gols) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Gols';
  secao.appendChild(titulo);

  const todos = [
    ...gols.mandante.map((g) => ({ ...g, lado: 'mandante' })),
    ...gols.visitante.map((g) => ({ ...g, lado: 'visitante' })),
  ].sort((a, b) => a.minuto.localeCompare(b.minuto));

  if (todos.length === 0) {
    secao.appendChild(linhaVazia('Sem gols registrados.'));
  }

  todos.forEach((gol) => {
    const linha = document.createElement('div');
    linha.className = 'evento-linha';
    const minuto = document.createElement('span');
    minuto.className = 'minuto';
    minuto.textContent = gol.minuto;
    const texto = document.createElement('span');
    texto.textContent = `${gol.atleta.nome_popular}${gol.penalti ? ' (pênalti)' : ''}${gol.gol_contra ? ' (contra)' : ''}`;
    linha.append(minuto, texto);
    secao.appendChild(linha);
  });

  return secao;
}

function secaoCartoes(cartoes) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Cartões';
  secao.appendChild(titulo);

  const todos = [
    ...cartoes.amarelo.mandante.map((c) => ({ ...c, tipo: 'Amarelo' })),
    ...cartoes.amarelo.visitante.map((c) => ({ ...c, tipo: 'Amarelo' })),
    ...cartoes.vermelho.mandante.map((c) => ({ ...c, tipo: 'Vermelho' })),
    ...cartoes.vermelho.visitante.map((c) => ({ ...c, tipo: 'Vermelho' })),
  ];

  if (todos.length === 0) {
    secao.appendChild(linhaVazia('Sem cartões registrados.'));
  }

  todos.forEach((cartao) => {
    const linha = document.createElement('div');
    linha.className = 'evento-linha';
    const minuto = document.createElement('span');
    minuto.className = 'minuto';
    minuto.textContent = cartao.minuto ?? '';
    const texto = document.createElement('span');
    texto.textContent = `${cartao.tipo} — ${cartao.atleta?.nome_popular ?? ''}`;
    linha.append(minuto, texto);
    secao.appendChild(linha);
  });

  return secao;
}

function linhaVazia(texto) {
  const p = document.createElement('p');
  p.className = 'vazio';
  p.textContent = texto;
  return p;
}

function parsePercentual(valor) {
  return parseInt(valor, 10) || 0;
}

const CATEGORIAS_STATS = {
  principais: 'Principais',
  finalizacoes: 'Finalizações',
  passes: 'Passes',
  defesa: 'Defesa',
};

function linhasPorCategoria(chave, estatisticas) {
  const m = estatisticas.mandante;
  const v = estatisticas.visitante;

  const mapa = {
    principais: [
      { label: 'Finalizações', m: m.finalizacao.total, v: v.finalizacao.total },
      { label: 'Chutes no gol', m: m.finalizacao.no_gol, v: v.finalizacao.no_gol },
      { label: 'Escanteios', m: m.escanteios, v: v.escanteios },
      { label: 'Faltas cometidas', m: m.faltas, v: v.faltas },
      { label: 'Impedimentos', m: m.impedimentos, v: v.impedimentos },
    ],
    finalizacoes: [
      { label: 'Finalizações totais', m: m.finalizacao.total, v: v.finalizacao.total },
      { label: 'No gol', m: m.finalizacao.no_gol, v: v.finalizacao.no_gol },
      { label: 'Para fora', m: m.finalizacao.pra_fora, v: v.finalizacao.pra_fora },
      { label: 'Na trave', m: m.finalizacao.na_trave, v: v.finalizacao.na_trave },
      { label: 'Bloqueadas', m: m.finalizacao.bloqueado, v: v.finalizacao.bloqueado },
      {
        label: 'Precisão de finalização',
        m: parsePercentual(m.finalizacao.precisao),
        v: parsePercentual(v.finalizacao.precisao),
        sufixo: '%',
      },
    ],
    passes: [
      { label: 'Passes totais', m: m.passes.total, v: v.passes.total },
      { label: 'Passes completos', m: m.passes.completos, v: v.passes.completos },
      { label: 'Passes errados', m: m.passes.errados, v: v.passes.errados },
      {
        label: 'Precisão de passe',
        m: parsePercentual(m.passes.precisao),
        v: parsePercentual(v.passes.precisao),
        sufixo: '%',
      },
    ],
    defesa: [
      { label: 'Desarmes', m: m.desarmes, v: v.desarmes },
      { label: 'Defesas do goleiro', m: m.defensivo.defesas, v: v.defensivo.defesas },
      { label: 'Faltas cometidas', m: m.faltas, v: v.faltas },
      { label: 'Impedimentos', m: m.impedimentos, v: v.impedimentos },
    ],
  };

  return mapa[chave];
}

function criarBarraPosse(estatisticas) {
  const wrap = document.createElement('div');

  const label = document.createElement('div');
  label.className = 'posse-bar-label';
  label.textContent = 'Posse de bola';

  const m = parsePercentual(estatisticas.mandante.posse_de_bola);
  const v = parsePercentual(estatisticas.visitante.posse_de_bola);

  const barra = document.createElement('div');
  barra.className = 'posse-bar';

  const ladoM = document.createElement('div');
  ladoM.className = 'lado mandante-lado';
  ladoM.style.width = `${m}%`;
  ladoM.textContent = `${m}%`;

  const ladoV = document.createElement('div');
  ladoV.className = 'lado visitante-lado';
  ladoV.style.width = `${v}%`;
  ladoV.textContent = `${v}%`;

  barra.append(ladoM, ladoV);
  wrap.append(label, barra);
  return wrap;
}

function criarStatRow({ label, m, v, sufixo = '' }) {
  const linha = document.createElement('div');
  linha.className = 'stat-row';

  const pillM = document.createElement('span');
  pillM.className = 'stat-pill' + (m > v ? ' lead-mandante' : '');
  pillM.textContent = `${m}${sufixo}`;

  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;

  const pillV = document.createElement('span');
  pillV.className = 'stat-pill' + (v > m ? ' lead-visitante' : '');
  pillV.textContent = `${v}${sufixo}`;

  linha.append(pillM, labelEl, pillV);
  return linha;
}

function secaoEstatisticas(estatisticas, nomeMandante, nomeVisitante) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Estatísticas';
  secao.appendChild(titulo);

  const card = document.createElement('div');
  card.className = 'stats-card';

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'stats-tabs';

  const teamsRow = document.createElement('div');
  teamsRow.className = 'stats-teams';
  const nomeM = document.createElement('span');
  nomeM.textContent = nomeMandante;
  const nomeV = document.createElement('span');
  nomeV.textContent = nomeVisitante;
  teamsRow.append(nomeM, nomeV);

  const corpo = document.createElement('div');

  function renderCorpo(chave) {
    corpo.replaceChildren();
    if (chave === 'principais') {
      corpo.appendChild(criarBarraPosse(estatisticas));
    }
    linhasPorCategoria(chave, estatisticas).forEach((item) => corpo.appendChild(criarStatRow(item)));
  }

  Object.entries(CATEGORIAS_STATS).forEach(([chave, label]) => {
    const btn = document.createElement('button');
    btn.className = 'stats-tab-btn' + (chave === 'principais' ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      tabsWrap.querySelectorAll('.stats-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderCorpo(chave);
    });
    tabsWrap.appendChild(btn);
  });

  renderCorpo('principais');

  card.append(tabsWrap, teamsRow, corpo);
  secao.appendChild(card);
  return secao;
}

document.getElementById('modal-close').addEventListener('click', () => {
  modalOverlay.classList.remove('active');
});

modalOverlay.addEventListener('click', (evento) => {
  if (evento.target === modalOverlay) {
    modalOverlay.classList.remove('active');
  }
});

async function iniciar() {
  carregarUsoApi();
  const temCampeonatos = await carregarCampeonatosSelect();
  if (temCampeonatos) carregarJogos();
}

iniciar();
