const campeonatoSelect = document.getElementById('campeonato-select');
const tabelaBody = document.getElementById('tabela-body');
const aoVivoLista = document.getElementById('ao-vivo-lista');
const artilhariaLista = document.getElementById('artilharia-lista');
const modalOverlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const modalBaixarPdfBtn = document.getElementById('modal-baixar-pdf');
const modalVoltarBtn = document.getElementById('modal-voltar');
const jogosLista = document.getElementById('jogos-lista');
const rodadaTitulo = document.getElementById('rodada-titulo');
const btnRodadaAnterior = document.getElementById('rodada-anterior');
const btnRodadaProxima = document.getElementById('rodada-proxima');
const quantidadeSelect = document.getElementById('quantidade-select');
const limiarSelect = document.getElementById('limiar-select');
const btnCalcularProvaveis = document.getElementById('btn-calcular-provaveis');
const provaveisLista = document.getElementById('provaveis-lista');
const provaveisDias = document.getElementById('provaveis-dias');
const datasPills = document.getElementById('datas-pills');
const chatMensagens = document.getElementById('chat-mensagens');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatConfigBtn = document.getElementById('chat-config-btn');
const chatSelecionarBtn = document.getElementById('chat-selecionar-btn');
const jogosSelecionarBtn = document.getElementById('jogos-selecionar-btn');
const pesquisadosLista = document.getElementById('pesquisados-lista');
const conferirResultadosBtn = document.getElementById('conferir-resultados-btn');
const notificarBtn = document.getElementById('notificar-btn');
const acertometroEl = document.getElementById('acertometro');

let rodadaExibida = null;

async function fetchJSON(url, options) {
  const resposta = await fetch(url, options);

  // Atualiza o badge de cota depois de qualquer chamada (menos /api/status
  // em si, senão vira loop) - assim ele reflete a cota real sem precisar
  // recarregar a página. Não usa "await": é só pra refrescar o número no
  // canto, não deve atrasar a resposta que quem chamou está esperando.
  if (url !== '/api/status') carregarUsoApi();

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    const detalhe = corpo?.detail ?? corpo?.error ?? `HTTP ${resposta.status}`;
    const mensagem = typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe);
    if (mensagem.includes('limite diário')) {
      mostrarToast('Cota diária da API esgotada. Tenta de novo mais tarde.', 'aviso');
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
    if (btn.dataset.tab === 'provaveis') carregarDiasProvaveis();
  });
});

campeonatoSelect.addEventListener('change', () => {
  rodadaExibida = null;
  carregarJogos();
  carregarTabela();
  carregarArtilharia();
  if (document.getElementById('provaveis').classList.contains('active')) carregarDiasProvaveis();
});

// --- Jogos por rodada / data ---

// Uma partida "conta" como atual/futura se ainda vai rolar hoje ou depois -
// usado pra decidir se a rodada atual do campeonato já terminou.
function temJogoAtualOuFuturo(partidas) {
  if (!partidas || partidas.length === 0) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return partidas.some((partida) => {
    const iso = partida.data_realizacao_iso ?? partida.data_realizacao;
    const data = new Date(iso);
    data.setHours(0, 0, 0, 0);
    return data >= hoje;
  });
}

async function carregarJogos(numeroRodada) {
  jogosLista.replaceChildren();
  rodadaTitulo.textContent = 'Carregando...';
  btnRodadaAnterior.disabled = true;
  btnRodadaProxima.disabled = true;

  const campeonatoId = campeonatoSelect.value;
  const usarRodadaAtual = numeroRodada == null;

  try {
    if (usarRodadaAtual) {
      const campeonatos = await fetchJSON('/api/campeonatos');
      const atual = campeonatos.find((c) => String(c.campeonato_id) === campeonatoId);
      numeroRodada = atual?.rodada_atual?.rodada;
    }

    if (numeroRodada == null) {
      rodadaTitulo.textContent = '';
      jogosLista.appendChild(linhaVazia('Este campeonato é disputado em fases de mata-mata, sem rodadas sequenciais.'));
      return;
    }

    let rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numeroRodada}`);

    // Ao abrir o app, se a rodada "atual" do campeonato já terminou (todos os
    // jogos no passado), pula pra próxima - senão a tela abre em jogos que já
    // aconteceram em vez dos mais próximos de hoje.
    if (usarRodadaAtual) {
      let tentativas = 0;
      while (rodada.proxima_rodada && !temJogoAtualOuFuturo(rodada.partidas) && tentativas < 3) {
        rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${rodada.proxima_rodada.rodada}`);
        tentativas += 1;
      }
    }

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

  const chaves = [...grupos.keys()];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  // Prioriza o primeiro dia de hoje em diante (mais próximo do atual); se a
  // rodada inteira já ficou no passado, cai pro último dia (o mais recente).
  let chaveInicial = chaves.find((chave) => {
    const iso = grupos.get(chave)[0].data_realizacao_iso ?? chave;
    const data = new Date(iso);
    data.setHours(0, 0, 0, 0);
    return data >= hoje;
  }) ?? chaves[chaves.length - 1];

  function mostrarGrupo(chave) {
    const jogosDoDia = grupos.get(chave);
    const dataIso = jogosDoDia[0].data_realizacao_iso ?? chave;

    jogosLista.replaceChildren();
    const grupo = document.createElement('div');
    grupo.className = 'data-grupo';

    const cabecalho = document.createElement('div');
    cabecalho.className = 'data-cabecalho';
    cabecalho.textContent = formatarData(dataIso);
    grupo.appendChild(cabecalho);

    jogosDoDia.forEach((partida) => grupo.appendChild(criarLinhaJogo(partida)));
    jogosLista.appendChild(grupo);

    datasPills.querySelectorAll('.data-pill').forEach((p) => {
      p.classList.toggle('active', p.dataset.chave === chave);
    });
  }

  chaves.forEach((chave) => {
    const jogosDoDia = grupos.get(chave);
    const dataIso = jogosDoDia[0].data_realizacao_iso ?? chave;

    const pill = document.createElement('button');
    pill.className = 'data-pill';
    pill.dataset.chave = chave;
    const rotulo = document.createElement('div');
    rotulo.className = 'pill-rotulo';
    rotulo.textContent = formatarRotuloPill(dataIso);
    const subrotulo = document.createElement('div');
    subrotulo.className = 'pill-data';
    subrotulo.textContent = formatarDataCurta(dataIso);
    pill.append(rotulo, subrotulo);
    pill.addEventListener('click', () => mostrarGrupo(chave));
    datasPills.appendChild(pill);
  });

  mostrarGrupo(chaveInicial);
}

function criarLinhaJogo(partida) {
  const linha = document.createElement('div');
  linha.className = 'jogo-linha';
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
//
// Calcular todos os jogos de uma rodada de uma vez gasta a cota rápido (2
// requisições de forma por jogo). Por isso o fluxo é em duas etapas: primeiro
// só lista os dias com jogo agendado (barato, cacheável), depois o usuário
// escolhe um dia específico e só aí roda o cálculo - só pros jogos daquele dia.

let provaveisRodada = null;
let provaveisDiaSelecionado = null;
let provaveisResultadosCalculados = null;

btnCalcularProvaveis.addEventListener('click', calcularProvaveis);

// Trocar o % mínimo só reordena/filtra o que já foi calculado - não refaz as
// requisições. Só some se ainda não tiver calculado o dia selecionado.
limiarSelect.addEventListener('change', () => {
  if (!provaveisResultadosCalculados) return;
  renderProvaveisFiltrado(Number(limiarSelect.value));
});

// Filtra os resultados já calculados pelo limiar escolhido. Cada jogo pode
// entrar com mais de um palpite (gols, escanteios, cartões - o que passar do
// limiar), não só o melhor - "aproveitando cada detalhe" em vez de escolher
// um vencedor único e descartar o resto. Se nenhum jogo bater o limiar,
// mostra o melhor palpite dos 3 jogos mais próximos disso mesmo assim -
// "nenhum jogo forte" não deveria significar "nenhuma informação".
function renderProvaveisFiltrado(limiar) {
  const validos = provaveisResultadosCalculados.resultados.filter(Boolean);

  const jogosFiltrados = validos
    .map((r) => ({
      partida: r.partida,
      palpites: r.candidatos.filter((c) => c.pct >= limiar).sort((a, b) => b.pct - a.pct),
    }))
    .filter((j) => j.palpites.length > 0)
    .sort((a, b) => b.palpites[0].pct - a.palpites[0].pct)
    .slice(0, 8);

  if (jogosFiltrados.length > 0) {
    renderProvaveis(jogosFiltrados, provaveisResultadosCalculados.falhas);
    return;
  }

  const melhoresPorJogo = validos
    .map((r) => ({ partida: r.partida, palpites: [...r.candidatos].sort((a, b) => b.pct - a.pct).slice(0, 1) }))
    .sort((a, b) => b.palpites[0].pct - a.palpites[0].pct)
    .slice(0, 3);

  renderProvaveis(melhoresPorJogo, provaveisResultadosCalculados.falhas, { abaixoDoLimiar: true, limiar });
}

async function carregarDiasProvaveis() {
  provaveisDias.replaceChildren();
  provaveisLista.replaceChildren();
  provaveisRodada = null;
  provaveisDiaSelecionado = null;
  btnCalcularProvaveis.disabled = true;
  btnCalcularProvaveis.textContent = 'Calcular jogos prováveis';

  const campeonatoId = campeonatoSelect.value;

  try {
    const campeonatos = await fetchJSON('/api/campeonatos');
    const infoCampeonato = campeonatos.find((c) => String(c.campeonato_id) === campeonatoId);
    const numeroRodadaAtual = infoCampeonato?.rodada_atual?.rodada;

    if (numeroRodadaAtual == null) {
      provaveisLista.appendChild(linhaVazia('Este campeonato não tem rodadas sequenciais pra calcular.'));
      return;
    }

    let rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numeroRodadaAtual}`);
    let tentativas = 0;
    while (rodada.proxima_rodada && !temJogoAtualOuFuturo(rodada.partidas) && tentativas < 3) {
      rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${rodada.proxima_rodada.rodada}`);
      tentativas += 1;
    }

    provaveisRodada = rodada;
    const agendados = (rodada.partidas ?? []).filter((p) => p.status === 'agendado');

    if (agendados.length === 0) {
      provaveisLista.appendChild(linhaVazia('Nenhum jogo agendado nesta rodada no momento.'));
      return;
    }

    const grupos = new Map();
    agendados.forEach((partida) => {
      const chave = partida.data_realizacao;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(partida);
    });

    const chaves = [...grupos.keys()];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const chaveInicial = chaves.find((chave) => {
      const iso = grupos.get(chave)[0].data_realizacao_iso ?? chave;
      const data = new Date(iso);
      data.setHours(0, 0, 0, 0);
      return data >= hoje;
    }) ?? chaves[chaves.length - 1];

    chaves.forEach((chave) => {
      const jogosDoDia = grupos.get(chave);
      const dataIso = jogosDoDia[0].data_realizacao_iso ?? chave;

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'data-pill';
      pill.dataset.chave = chave;
      const rotulo = document.createElement('div');
      rotulo.className = 'pill-rotulo';
      rotulo.textContent = formatarRotuloPill(dataIso);
      const subrotulo = document.createElement('div');
      subrotulo.className = 'pill-data';
      subrotulo.textContent = `${formatarDataCurta(dataIso)} · ${jogosDoDia.length} jogo${jogosDoDia.length > 1 ? 's' : ''}`;
      pill.append(rotulo, subrotulo);
      pill.addEventListener('click', () => selecionarDiaProvaveis(chave, jogosDoDia, dataIso));
      provaveisDias.appendChild(pill);
    });

    selecionarDiaProvaveis(chaveInicial, grupos.get(chaveInicial), grupos.get(chaveInicial)[0].data_realizacao_iso ?? chaveInicial);
  } catch (err) {
    provaveisLista.appendChild(linhaVazia(`Não foi possível carregar os dias: ${err.message}`));
  }
}

function selecionarDiaProvaveis(chave, jogosDoDia, dataIso) {
  provaveisDiaSelecionado = { chave, jogos: jogosDoDia };
  provaveisResultadosCalculados = null;
  provaveisDias.querySelectorAll('.data-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.chave === chave);
  });
  provaveisLista.replaceChildren();
  btnCalcularProvaveis.disabled = false;
  btnCalcularProvaveis.textContent = `Calcular prováveis de ${formatarData(dataIso)}`;
}

async function calcularProvaveis() {
  if (!provaveisDiaSelecionado || !provaveisRodada) return;

  const campeonatoId = campeonatoSelect.value;
  const quantidade = quantidadeSelect.value;
  const limiar = Number(limiarSelect.value);
  const numeroRodada = provaveisRodada.rodada;
  const agendados = provaveisDiaSelecionado.jogos;
  const textoBotao = btnCalcularProvaveis.textContent;

  btnCalcularProvaveis.disabled = true;
  btnCalcularProvaveis.textContent = 'Calculando...';
  provaveisLista.replaceChildren();

  try {
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

        const nomeMandante = partida.time_mandante.nome_popular;
        const nomeVisitante = partida.time_visitante.nome_popular;
        const est = estimarProbabilidades(formaMandante.medias, formaVisitante.medias);

        // Não usa vitória/empate/derrota (nem dupla chance, que é só a soma de
        // dois desses três) como candidato aqui - esse número já é o primeiro
        // que aparece ao abrir o confronto (barra "Estimativa estatística").
        // Prováveis serve pra mostrar mercados específicos que não estão em
        // destaque lá: gols, escanteios, cartões - ideias de aposta de verdade,
        // não o mesmo placar provável reembalado.
        const candidatos = [
          { label: 'Ambas marcam', pct: est.ambasMarcam },
          { label: 'Não ambas marcam', pct: 100 - est.ambasMarcam },
          { label: 'Mais de 2.5 gols', pct: est.maisDe25Gols },
          { label: 'Menos de 2.5 gols', pct: 100 - est.maisDe25Gols },
        ];

        // Escanteios e cartões vêm da frequência histórica do próprio time
        // (mesma conta da seção "Chances" do comparativo), não do modelo de
        // Poisson - por isso são calculados à parte, um candidato pra cada
        // lado do jogo.
        if (formaMandante.jogos?.length) {
          const alertasMandante = calcularAlertas(formaMandante.jogos, formaMandante.medias);
          const escMandante = alertasMandante.find((a) => a.label === 'Escanteios');
          if (escMandante) candidatos.push({ label: `${nomeMandante}: escanteios > ${escMandante.linha}`, pct: escMandante.percentual });
          const cartoesMandante = alertasMandante.find((a) => a.label === 'Cartões amarelos');
          if (cartoesMandante) candidatos.push({ label: `${nomeMandante}: cartões amarelos > ${cartoesMandante.linha}`, pct: cartoesMandante.percentual });
        }
        if (formaVisitante.jogos?.length) {
          const alertasVisitante = calcularAlertas(formaVisitante.jogos, formaVisitante.medias);
          const escVisitante = alertasVisitante.find((a) => a.label === 'Escanteios');
          if (escVisitante) candidatos.push({ label: `${nomeVisitante}: escanteios > ${escVisitante.linha}`, pct: escVisitante.percentual });
          const cartoesVisitante = alertasVisitante.find((a) => a.label === 'Cartões amarelos');
          if (cartoesVisitante) candidatos.push({ label: `${nomeVisitante}: cartões amarelos > ${cartoesVisitante.linha}`, pct: cartoesVisitante.percentual });
        }

        return { partida, candidatos };
      }),
    );

    const resultados = settled.map((s) => {
      if (s.status === 'rejected') {
        falhas += 1;
        return null;
      }
      return s.value;
    });

    provaveisResultadosCalculados = { resultados, falhas };
    renderProvaveisFiltrado(limiar);
  } catch (err) {
    provaveisLista.appendChild(linhaVazia(`Não foi possível calcular: ${err.message}`));
  } finally {
    btnCalcularProvaveis.disabled = false;
    btnCalcularProvaveis.textContent = textoBotao;
  }
}

function renderProvaveis(jogos, falhas = 0, { abaixoDoLimiar = false, limiar = null } = {}) {
  provaveisLista.replaceChildren();

  if (falhas > 0) {
    const aviso = falhas === 1 ? '1 jogo não pôde ser calculado agora (sem dados em cache) e ficou de fora.' : `${falhas} jogos não puderam ser calculados agora (sem dados em cache) e ficaram de fora.`;
    provaveisLista.appendChild(linhaVazia(aviso));
  }

  if (jogos.length === 0) {
    provaveisLista.appendChild(linhaVazia('Nenhum jogo desse dia pôde ser calculado agora.'));
    return;
  }

  if (abaixoDoLimiar) {
    provaveisLista.appendChild(linhaVazia(`Nenhum palpite bateu ${limiar}% nesse dia. Esses foram os mais fortes mesmo assim:`));
  }

  const lista = document.createElement('ol');
  lista.className = 'provaveis-ranking';

  jogos.forEach(({ partida, palpites }) => {
    const li = document.createElement('li');
    li.className = 'provavel-item';
    li.addEventListener('click', () => abrirFormaPreJogo(partida));

    const cabecalho = document.createElement('div');
    cabecalho.className = 'provavel-cabecalho';
    cabecalho.appendChild(el2('span', 'provavel-confronto', `${partida.time_mandante.nome_popular} x ${partida.time_visitante.nome_popular}`));
    cabecalho.appendChild(el2('span', 'provavel-detalhe', partida.hora_realizacao ?? ''));
    li.appendChild(cabecalho);

    const chips = document.createElement('div');
    chips.className = 'prob-mercados-extra provavel-palpites';
    palpites.forEach(({ label, pct }) => {
      const chip = document.createElement('span');
      chip.className = 'mercado-chip mercado-chip-forte';
      chip.textContent = `${label}: ${pct}%`;
      chips.appendChild(chip);
    });
    li.appendChild(chips);

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

    tabelaBody.appendChild(tr);
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
    aoVivoLista.appendChild(criarCardJogo(partida));
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
    nome.textContent = `${item.atleta.nome_popular} (${item.time.nome_popular})`;

    const gols = document.createElement('span');
    gols.className = 'gols';
    gols.textContent = `${item.gols} gols`;

    li.append(img, nome, gols);
    artilhariaLista.appendChild(li);
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
  modalBaixarPdfBtn.hidden = true;
  modalVoltarBtn.hidden = true;
  modalVoltarCallback = null;
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
  habilitarBaixarPdf(times.textContent);

  let formaMandante;
  let formaVisitante;
  let linhaMandante;
  let linhaVisitante;
  // Os dados só terminam de carregar mais abaixo - o botão lê as variáveis
  // no momento do clique, então pode ser criado aqui em cima mesmo assim.
  modalContent.appendChild(
    botaoCopiar((botao) =>
      copiarTexto(botao, () =>
        formaMandante?.medias && formaVisitante?.medias
          ? montarTextoComparativoJogo(partida, formaMandante, formaVisitante, linhaMandante, linhaVisitante)
          : null,
      ),
    ),
  );

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

  linhaMandante = tabela.find((l) => l.time.time_id === partida.time_mandante.time_id);
  linhaVisitante = tabela.find((l) => l.time.time_id === partida.time_visitante.time_id);

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

// Texto simples do comparativo pré-jogo (contexto, forma recente, médias e
// estimativa) pra colar em qualquer lugar - reaproveita os mesmos cálculos
// já usados nas seções visuais.
function montarTextoComparativoJogo(partida, formaMandante, formaVisitante, linhaMandante, linhaVisitante) {
  const nomeMandante = partida.time_mandante.nome_popular;
  const nomeVisitante = partida.time_visitante.nome_popular;
  const linhas = [`${nomeMandante} x ${nomeVisitante}`, ''];

  if (linhaMandante) linhas.push(`${nomeMandante}: ${linhaMandante.posicao}º, ${linhaMandante.pontos} pts`);
  if (linhaVisitante) linhas.push(`${nomeVisitante}: ${linhaVisitante.posicao}º, ${linhaVisitante.pontos} pts`);
  linhas.push('');

  linhas.push(`Forma recente ${nomeMandante} (mais recente primeiro): ${formaMandante.jogos.map((j) => j.resultado).join(', ')}`);
  linhas.push(`Forma recente ${nomeVisitante} (mais recente primeiro): ${formaVisitante.jogos.map((j) => j.resultado).join(', ')}`);
  linhas.push('');

  linhas.push(`Médias (${nomeMandante} / ${nomeVisitante})`);
  LINHAS_COMPARATIVO.forEach(([label, campo, sufixo]) => {
    linhas.push(`${label}: ${formaMandante.medias[campo]}${sufixo} / ${formaVisitante.medias[campo]}${sufixo}`);
  });
  linhas.push('');

  const estimativa = estimarProbabilidades(formaMandante.medias, formaVisitante.medias);
  linhas.push('Estimativa estatística (modelo de Poisson)');
  linhas.push(`${nomeMandante} ${estimativa.vitoriaMandante}% - Empate ${estimativa.empate}% - ${nomeVisitante} ${estimativa.vitoriaVisitante}%`);
  linhas.push(`Gols esperados: ${nomeMandante} ${estimativa.xgMandante} x ${estimativa.xgVisitante} ${nomeVisitante}`);

  const fortes = palpitesFortes(estimativa, nomeMandante, nomeVisitante);
  if (fortes.length > 0) {
    linhas.push('');
    linhas.push('Palpites fortes:');
    fortes.forEach(({ label, valor }) => linhas.push(`- ${label}: ${valor}%`));
  }

  return linhas.join('\n').trim();
}

// Abas pra escolher um dos dois times e ver o perfil individual dele
// (médias, top 5) sem sair do comparativo do jogo. As "Chances" ficam de
// fora da troca de aba - mostram os dois times ao mesmo tempo, porque são
// estatísticas da partida como um todo, não só de um lado do confronto.
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
  secao.append(tabsWrap, corpo, secaoAlertasComparativo(times));
  return secao;
}

function secaoAlertasComparativo(times) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Chances (com base nos últimos jogos de cada time)';
  secao.appendChild(titulo);

  times.forEach(({ nome, forma }) => {
    secao.appendChild(criarBlocoChances(nome, calcularAlertas(forma.jogos, forma.medias)));
  });

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
    badge.title = `${jogo.mandante ? 'vs' : '@'} ${jogo.adversario}: ${jogo.placar}`;
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
  // Mercados extras (estilo casa de aposta) - saem da mesma grade de Poisson,
  // só somando outras combinações de placar em vez de comparar i/j.
  let ambasMarcam = 0;
  let maisDe25Gols = 0;

  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const probabilidade = poisson(xgMandante, i) * poisson(xgVisitante, j);
      if (i > j) vitoriaMandante += probabilidade;
      else if (i === j) empate += probabilidade;
      else vitoriaVisitante += probabilidade;

      if (i >= 1 && j >= 1) ambasMarcam += probabilidade;
      if (i + j > 2.5) maisDe25Gols += probabilidade;
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
    ambasMarcam: Math.round((ambasMarcam / total) * 100),
    maisDe25Gols: Math.round((maisDe25Gols / total) * 100),
  };
}

function criarBarraProbabilidade(nomeMandante, nomeVisitante, estimativa) {
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

  const fortes = palpitesFortes(estimativa, nomeMandante, nomeVisitante);
  if (fortes.length > 0) {
    const bloco = document.createElement('div');
    bloco.className = 'prob-palpites-fortes';

    const titulo = document.createElement('div');
    titulo.className = 'prob-palpites-titulo';
    titulo.textContent = 'Palpites fortes';
    bloco.appendChild(titulo);

    const lista = document.createElement('div');
    lista.className = 'prob-mercados-extra';
    fortes.forEach(({ label, valor }) => {
      const chip = document.createElement('span');
      chip.className = 'mercado-chip mercado-chip-forte';
      chip.textContent = `${label}: ${valor}%`;
      lista.appendChild(chip);
    });
    bloco.appendChild(lista);
    card.appendChild(bloco);
  } else {
    const semForte = document.createElement('p');
    semForte.className = 'prob-nota';
    semForte.textContent = 'Nenhum palpite forte pra esse jogo - times parecem equilibrados.';
    card.appendChild(semForte);
  }

  return card;
}

// Junta todos os mercados calculados (vitória/empate/derrota, ambas marcam,
// mais/menos de 2.5 gols) e devolve só os que passam de um limiar de
// confiança, do maior pro menor - em vez de sempre mostrar os mesmos
// números fixos (tipo "ambas marcam") mesmo quando o jogo não indica nada
// forte de um lado ou de outro.
function palpitesFortes(estimativa, nomeMandante, nomeVisitante, limiar = 60) {
  const candidatos = [
    { label: `Vitória de ${nomeMandante}`, valor: estimativa.vitoriaMandante },
    { label: 'Empate', valor: estimativa.empate },
    { label: `Vitória de ${nomeVisitante}`, valor: estimativa.vitoriaVisitante },
  ];
  if (estimativa.ambasMarcam != null) {
    candidatos.push({ label: 'Ambas marcam', valor: estimativa.ambasMarcam });
    candidatos.push({ label: 'Não ambas marcam', valor: 100 - estimativa.ambasMarcam });
  }
  if (estimativa.maisDe25Gols != null) {
    candidatos.push({ label: 'Mais de 2.5 gols', valor: estimativa.maisDe25Gols });
    candidatos.push({ label: 'Menos de 2.5 gols', valor: 100 - estimativa.maisDe25Gols });
  }
  return candidatos.filter((c) => c.valor >= limiar).sort((a, b) => b.valor - a.valor);
}

function secaoProbabilidade(nomeMandante, nomeVisitante, mediasMandante, mediasVisitante) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';

  const titulo = document.createElement('h3');
  titulo.textContent = 'Estimativa estatística';
  secao.appendChild(titulo);

  const estimativa = estimarProbabilidades(mediasMandante, mediasVisitante);
  const card = criarBarraProbabilidade(nomeMandante, nomeVisitante, estimativa);

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
  modalBaixarPdfBtn.hidden = true;
  modalVoltarBtn.hidden = true;
  modalVoltarCallback = null;
  modalOverlay.classList.add('active');

  const campeonatoId = campeonatoSelect.value;
  const quantidade = quantidadeSelect.value;
  const time = linhaTabela.time;
  let forma;
  let jogosFuturos = [];

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
  habilitarBaixarPdf(nomeEl.textContent);

  // forma/jogosFuturos são lidos no momento do clique, não na criação do
  // botão - por isso dá pra criar o botão já aqui em cima, antes deles
  // terminarem de carregar.
  modalContent.appendChild(
    botaoCopiar((botao) => copiarTexto(botao, () => (forma ? montarTextoInformacoesTime(time, quantidade, forma, jogosFuturos) : null))),
  );

  const tagsRow = document.createElement('div');
  tagsRow.className = 'forma-tags-linha';
  modalContent.appendChild(tagsRow);

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
    jogosFuturos = await buscarProximosJogos(campeonatoId, numeroRodadaAtual, time.time_id);
    modalContent.appendChild(secaoJogosTime(time.time_id, forma.jogos, jogosFuturos, linhaTabela));
  } catch (err) {
    modalContent.appendChild(linhaVazia(`Não foi possível carregar os próximos jogos: ${err.message}`));
  }
}

// Monta um texto simples (pra colar no chat, whatsapp etc) com o resumo do
// time: médias, forma recente, próximos e últimos jogos - tudo que já
// calculamos, sem precisar printar tela.
function montarTextoInformacoesTime(time, quantidade, forma, jogosFuturos) {
  const linhas = [`${time.nome_popular} - últimos ${quantidade} jogos`, ''];

  if (forma.medias) {
    LINHAS_COMPARATIVO.forEach(([label, campo, sufixo]) => {
      linhas.push(`${label}: ${forma.medias[campo]}${sufixo}`);
    });
    linhas.push('');
  }

  if (forma.jogos?.length) {
    linhas.push(`Forma recente (mais recente primeiro): ${forma.jogos.map((j) => j.resultado).join(', ')}`);
    linhas.push('');
  }

  if (jogosFuturos.length > 0) {
    linhas.push('Próximos jogos:');
    jogosFuturos.forEach((partida) => {
      const mandante = partida.time_mandante.time_id === time.time_id;
      const adversario = mandante ? partida.time_visitante.nome_popular : partida.time_mandante.nome_popular;
      linhas.push(`- ${formatarDataCurta(partida.data_realizacao_iso)} ${mandante ? 'vs' : '@'} ${adversario}`);
    });
    linhas.push('');
  }

  if (forma.jogos?.length) {
    linhas.push('Últimos jogos:');
    forma.jogos.forEach((jogo) => {
      linhas.push(`- ${formatarDataCurta(jogo.data)} ${jogo.mandante ? 'vs' : '@'} ${jogo.adversario}: ${jogo.placar}`);
    });
  }

  return linhas.join('\n').trim();
}

// Botão de copiar genérico - `montarTexto` só é chamado no clique (não na
// criação do botão), então dá pra criar o botão antes dos dados terminarem
// de carregar e ele ainda funcionar certo depois.
async function copiarTexto(botao, montarTexto) {
  const texto = montarTexto();
  if (!texto) {
    mostrarToast('Ainda carregando os dados - espera só um instante.', 'aviso');
    return;
  }

  try {
    await navigator.clipboard.writeText(texto);
    const textoOriginal = botao.textContent;
    botao.textContent = 'Copiado!';
    setTimeout(() => {
      botao.textContent = textoOriginal;
    }, 1500);
  } catch {
    mostrarToast('Não foi possível copiar - copia manualmente pelo navegador.', 'aviso');
  }
}

function botaoCopiar(aoClicar) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'pesquisados-acao-btn';
  botao.textContent = 'Copiar informações';
  botao.addEventListener('click', () => aoClicar(botao));
  return botao;
}

// Lista de jogos do time, passados e futuros, tudo num lugar só (tipo o
// painel de partidas do Sofascore quando você clica num time). Os passados
// já vêm do "forma" que a gente buscou; os futuros escaneiam rodada por
// rodada a partir da atual, com um teto de tentativas pra não sair fetchando
// rodada atrás de rodada até o fim do campeonato à toa.
//
// O backend guarda rodada ainda não encerrada por só 5 min (pra pegar
// remarcação de horário) - reabrir o mesmo time pouco depois disso reconta
// aquele escaneamento inteiro de novo. Como data de próximo jogo não muda de
// minuto em minuto, um cache à parte aqui no front, com prazo mais folgado,
// evita gastar cota de novo só por reabrir o mesmo perfil.
const cacheProximosJogos = new Map();
const VALIDADE_PROXIMOS_JOGOS_MS = 20 * 60 * 1000;

async function buscarProximosJogos(campeonatoId, numeroRodadaAtual, timeId, maximo = 5) {
  const chave = `${campeonatoId}:${timeId}:${numeroRodadaAtual}`;
  const emCache = cacheProximosJogos.get(chave);
  if (emCache && Date.now() - emCache.quando < VALIDADE_PROXIMOS_JOGOS_MS) {
    return emCache.jogos;
  }

  const jogos = [];
  let numero = numeroRodadaAtual;
  let tentativas = 0;
  while (numero != null && jogos.length < maximo && tentativas < 10) {
    let rodada;
    try {
      rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numero}`);
    } catch {
      break;
    }
    const jogoDoTime = (rodada.partidas ?? []).find(
      (p) => p.status === 'agendado' && (p.time_mandante.time_id === timeId || p.time_visitante.time_id === timeId),
    );
    if (jogoDoTime) jogos.push(jogoDoTime);
    numero = rodada.proxima_rodada?.rodada ?? null;
    tentativas += 1;
  }

  cacheProximosJogos.set(chave, { quando: Date.now(), jogos });
  return jogos;
}

function secaoJogosTime(timeId, jogosPassados, jogosFuturos, linhaTabela) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Jogos';
  secao.appendChild(titulo);

  if (jogosFuturos.length === 0 && jogosPassados.length === 0) {
    secao.appendChild(linhaVazia('Nenhum jogo encontrado pra esse time.'));
    return secao;
  }

  // Volta pro mesmo perfil de time depois de ver o jogo - sem isso, quem
  // clica num jogo aqui de dentro fica preso na tela do jogo, sem um jeito
  // fácil de retomar de onde parou.
  const voltarParaPerfil = () => abrirPerfilTime(linhaTabela);

  jogosFuturos.forEach((partida) => {
    const mandante = partida.time_mandante.time_id === timeId;
    const adversario = mandante ? partida.time_visitante.nome_popular : partida.time_mandante.nome_popular;
    secao.appendChild(
      criarLinhaJogoTime({
        data: partida.data_realizacao_iso,
        adversario,
        mandante,
        situacaoTexto: 'AGENDADA',
        situacaoClasse: '',
        aoClicar: () => abrirFormaPreJogo(partida).then(() => configurarVoltar(voltarParaPerfil)),
      }),
    );
  });

  jogosPassados.forEach((jogo) => {
    secao.appendChild(
      criarLinhaJogoTime({
        data: jogo.data,
        adversario: jogo.adversario,
        mandante: jogo.mandante,
        situacaoTexto: jogo.placar,
        situacaoClasse: 'encerrada',
        aoClicar: () => abrirResumo(jogo.partidaId).then(() => configurarVoltar(voltarParaPerfil)),
      }),
    );
  });

  return secao;
}

function criarLinhaJogoTime({ data, adversario, mandante, situacaoTexto, situacaoClasse, aoClicar }) {
  const linha = document.createElement('div');
  linha.className = 'jogo-linha';
  linha.addEventListener('click', aoClicar);

  const dataEl = document.createElement('span');
  dataEl.className = 'horario';
  dataEl.textContent = formatarDataCurta(data);

  const confronto = document.createElement('div');
  confronto.className = 'confrontos';
  const timeLinha = document.createElement('div');
  timeLinha.className = 'time-linha';
  const nome = document.createElement('span');
  nome.textContent = `${mandante ? 'vs' : '@'} ${adversario}`;
  timeLinha.appendChild(nome);
  confronto.appendChild(timeLinha);

  const situacaoEl = document.createElement('span');
  situacaoEl.className = `situacao ${situacaoClasse}`;
  situacaoEl.textContent = situacaoTexto;

  linha.append(dataEl, confronto, situacaoEl);
  return linha;
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
  modalBaixarPdfBtn.hidden = true;
  modalVoltarBtn.hidden = true;
  modalVoltarCallback = null;
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
  habilitarBaixarPdf(times.textContent);
  modalContent.appendChild(botaoCopiar((botao) => copiarTexto(botao, () => montarTextoResumoJogo(resumo))));

  modalContent.appendChild(secaoInformacoes(resumo));
  modalContent.appendChild(secaoGols(resumo.gols));
  modalContent.appendChild(secaoCartoes(resumo.cartoes));
  modalContent.appendChild(secaoEstatisticas(resumo.estatisticas, resumo.cartoes, resumo.confronto.mandante, resumo.confronto.visitante));
}

// Texto simples do resumo do jogo (placar, gols, cartões, estatísticas
// gerais) pra colar em qualquer lugar - reaproveita a mesma lista de
// estatísticas que já monta a seção visual, só formatada como texto.
function montarTextoResumoJogo(resumo) {
  const nomeMandante = resumo.confronto.mandante;
  const nomeVisitante = resumo.confronto.visitante;
  const linhas = [`${nomeMandante} x ${nomeVisitante} - ${resumo.confronto.placar}`, ''];

  linhas.push(`Competição: ${resumo.partida.campeonato ?? '-'}`);
  linhas.push(`Estádio: ${resumo.partida.estadio ?? '-'}`);
  linhas.push(`Rodada: ${resumo.partida.rodada ?? '-'}`);
  linhas.push('');

  const gols = [
    ...resumo.gols.mandante.map((g) => ({ ...g, time: nomeMandante })),
    ...resumo.gols.visitante.map((g) => ({ ...g, time: nomeVisitante })),
  ].sort((a, b) => a.minuto.localeCompare(b.minuto));
  if (gols.length > 0) {
    linhas.push('Gols:');
    gols.forEach((g) => {
      linhas.push(`- ${g.minuto} ${g.atleta.nome_popular} (${g.time})${g.penalti ? ' [pênalti]' : ''}${g.gol_contra ? ' [contra]' : ''}`);
    });
    linhas.push('');
  }

  linhas.push(`Estatísticas gerais (${nomeMandante} / ${nomeVisitante})`);
  linhas.push(`Posse de bola: ${parsePercentual(resumo.estatisticas.mandante.posse_de_bola)}% / ${parsePercentual(resumo.estatisticas.visitante.posse_de_bola)}%`);
  linhasEstatisticasGerais(resumo.estatisticas, resumo.cartoes).forEach(({ label, m, v, sufixo = '' }) => {
    linhas.push(`${label}: ${m}${sufixo} / ${v}${sufixo}`);
  });

  return linhas.join('\n').trim();
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
    texto.textContent = `${cartao.tipo}: ${cartao.atleta?.nome_popular ?? ''}`;
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

// Visão geral da partida num único lugar (tipo o "Match overview" do
// Sofascore) - só com o que a API Futebol realmente mede. Não temos
// distância percorrida, sprints ou xG de rastreamento profissional (isso é
// dado pago de provedor tipo Opta, não dá pra replicar de graça); o que dá
// pra mostrar de verdade é posse, finalizações, escanteios, faltas, cartões,
// impedimentos, passes, desarmes e defesas do goleiro.
function linhasEstatisticasGerais(estatisticas, cartoes) {
  const m = estatisticas.mandante;
  const v = estatisticas.visitante;

  return [
    { label: 'Finalizações', m: m.finalizacao.total, v: v.finalizacao.total },
    { label: 'Chutes no gol', m: m.finalizacao.no_gol, v: v.finalizacao.no_gol },
    { label: 'Escanteios', m: m.escanteios, v: v.escanteios },
    { label: 'Faltas cometidas', m: m.faltas, v: v.faltas },
    { label: 'Cartões amarelos', m: cartoes.amarelo.mandante.length, v: cartoes.amarelo.visitante.length },
    { label: 'Cartões vermelhos', m: cartoes.vermelho.mandante.length, v: cartoes.vermelho.visitante.length },
    { label: 'Impedimentos', m: m.impedimentos, v: v.impedimentos },
    { label: 'Passes totais', m: m.passes.total, v: v.passes.total },
    { label: 'Precisão de passe', m: parsePercentual(m.passes.precisao), v: parsePercentual(v.passes.precisao), sufixo: '%' },
    { label: 'Desarmes', m: m.desarmes, v: v.desarmes },
    { label: 'Defesas do goleiro', m: m.defensivo.defesas, v: v.defensivo.defesas },
  ];
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

function secaoEstatisticas(estatisticas, cartoes, nomeMandante, nomeVisitante) {
  const secao = document.createElement('div');
  secao.className = 'resumo-secao';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Estatísticas gerais';
  secao.appendChild(titulo);

  const card = document.createElement('div');
  card.className = 'stats-card';

  const teamsRow = document.createElement('div');
  teamsRow.className = 'stats-teams';
  const nomeM = document.createElement('span');
  nomeM.textContent = nomeMandante;
  const nomeV = document.createElement('span');
  nomeV.textContent = nomeVisitante;
  teamsRow.append(nomeM, nomeV);

  const corpo = document.createElement('div');
  corpo.appendChild(criarBarraPosse(estatisticas));
  linhasEstatisticasGerais(estatisticas, cartoes).forEach((item) => corpo.appendChild(criarStatRow(item)));

  card.append(teamsRow, corpo);
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

// --- Voltar pro card anterior (quando um modal abre outro por cima, tipo
// clicar num jogo de dentro do perfil do time) ---
//
// A view que abre por cima já reseta esse botão pra escondido sozinha (no
// mesmo lugar que reseta o de baixar PDF). Por isso quem quer permitir voltar
// só registra o callback DEPOIS que a função de abrir terminar (via then) -
// assim ele não é apagado pelo reset da própria função que acabou de rodar.
let modalVoltarCallback = null;

function configurarVoltar(aoVoltar) {
  modalVoltarCallback = aoVoltar;
  modalVoltarBtn.hidden = false;
}

modalVoltarBtn.addEventListener('click', () => {
  const aoVoltar = modalVoltarCallback;
  if (aoVoltar) aoVoltar();
});

// --- Chat (assistente por IA via /api/chat - Claude, ChatGPT ou Gemini) ---

const CHAT_CONFIG_CHAVE = 'esportesAnalyticsChatConfig';
const CHAT_PROVEDORES = {
  anthropic: { nome: 'Claude (Anthropic)', modeloPadrao: 'claude-opus-5' },
  openai: { nome: 'ChatGPT (OpenAI)', modeloPadrao: 'gpt-5.6' },
  gemini: { nome: 'Gemini (Google)', modeloPadrao: 'gemini-2.5-flash' },
};

let chatHistorico = [];
let chatHistoricoProvedor = null;

function carregarConfigChat() {
  const base = { provedor: 'anthropic', apiKey: '', modelo: '', quantidadePadrao: 10 };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAT_CONFIG_CHAVE));
    return salvo ? { ...base, ...salvo } : base;
  } catch {
    return base;
  }
}

function salvarConfigChat(config) {
  localStorage.setItem(CHAT_CONFIG_CHAVE, JSON.stringify(config));
}

function abrirConfigChat() {
  const config = carregarConfigChat();
  modalContent.replaceChildren();
  modalBaixarPdfBtn.hidden = true;
  modalVoltarBtn.hidden = true;
  modalVoltarCallback = null;

  const titulo = document.createElement('h2');
  titulo.textContent = 'Configurar chat (IA)';
  modalContent.appendChild(titulo);

  const form = document.createElement('form');
  form.className = 'config-chat-form';

  const campoProvedor = document.createElement('label');
  campoProvedor.textContent = 'Provedor de IA';
  const selectProvedor = document.createElement('select');
  Object.entries(CHAT_PROVEDORES).forEach(([valor, info]) => {
    const opcao = document.createElement('option');
    opcao.value = valor;
    opcao.textContent = info.nome;
    if (valor === config.provedor) opcao.selected = true;
    selectProvedor.appendChild(opcao);
  });
  campoProvedor.appendChild(selectProvedor);
  form.appendChild(campoProvedor);

  const campoChave = document.createElement('label');
  campoChave.textContent = 'Chave de API';
  const inputChave = document.createElement('input');
  inputChave.type = 'password';
  inputChave.autocomplete = 'off';
  inputChave.value = config.apiKey ?? '';
  inputChave.placeholder = 'cole sua chave aqui';
  campoChave.appendChild(inputChave);
  form.appendChild(campoChave);

  const campoModelo = document.createElement('label');
  campoModelo.textContent = 'Modelo (opcional)';
  const inputModelo = document.createElement('input');
  inputModelo.type = 'text';
  inputModelo.value = config.modelo ?? '';
  const atualizarPlaceholderModelo = () => {
    inputModelo.placeholder = CHAT_PROVEDORES[selectProvedor.value].modeloPadrao;
  };
  atualizarPlaceholderModelo();
  selectProvedor.addEventListener('change', atualizarPlaceholderModelo);
  campoModelo.appendChild(inputModelo);
  form.appendChild(campoModelo);

  const campoQtd = document.createElement('label');
  campoQtd.textContent = 'Jogos analisados por time (a IA usa isso sem perguntar toda vez)';
  const selectQtd = document.createElement('select');
  [5, 10, 15].forEach((valor) => {
    const opcao = document.createElement('option');
    opcao.value = String(valor);
    opcao.textContent = `Últimos ${valor} jogos`;
    if (valor === Number(config.quantidadePadrao)) opcao.selected = true;
    selectQtd.appendChild(opcao);
  });
  campoQtd.appendChild(selectQtd);
  form.appendChild(campoQtd);

  const nota = document.createElement('p');
  nota.className = 'config-chat-nota';
  nota.textContent =
    'A chave fica salva só neste navegador (localStorage) e é enviada direto pro seu próprio backend a ' +
    'cada pergunta - nunca é compartilhada com outro lugar. Sem chave configurada aqui, o servidor tenta ' +
    'usar a variável de ambiente correspondente, se existir.';
  form.appendChild(nota);

  const btnSalvar = document.createElement('button');
  btnSalvar.type = 'submit';
  btnSalvar.textContent = 'Salvar';
  form.appendChild(btnSalvar);

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    salvarConfigChat({
      provedor: selectProvedor.value,
      apiKey: inputChave.value.trim(),
      modelo: inputModelo.value.trim(),
      quantidadePadrao: Number(selectQtd.value),
    });
    modalOverlay.classList.remove('active');
    mostrarToast('Configuração do chat salva.', 'info');
  });

  modalContent.appendChild(form);
  modalOverlay.classList.add('active');
}

chatConfigBtn?.addEventListener('click', abrirConfigChat);

function adicionarMensagemChat(texto, classes) {
  const bolha = document.createElement('div');
  bolha.className = `chat-msg ${classes}`;
  bolha.textContent = texto;
  chatMensagens.appendChild(bolha);
  chatMensagens.scrollTop = chatMensagens.scrollHeight;
  return bolha;
}

async function enviarMensagemChat(mensagem, rotuloBolhaUsuario) {
  const config = carregarConfigChat();
  // Cada provedor guarda o histórico num formato diferente - trocar de
  // provedor no meio da conversa reseta o histórico em vez de mandar um
  // formato incompatível pro provedor novo.
  if (chatHistoricoProvedor !== config.provedor) {
    chatHistorico = [];
    chatHistoricoProvedor = config.provedor;
  }

  chatInput.disabled = true;
  adicionarMensagemChat(rotuloBolhaUsuario ?? mensagem, 'usuario');
  const bolhaResposta = adicionarMensagemChat('Analisando...', 'assistente carregando');

  try {
    const resposta = await fetchJSON('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensagem,
        historico: chatHistorico,
        provedor: config.provedor,
        apiKey: config.apiKey || undefined,
        modelo: config.modelo || undefined,
        quantidadePadrao: config.quantidadePadrao,
      }),
    });
    chatHistorico = resposta.historico ?? chatHistorico;
    bolhaResposta.textContent = resposta.resposta;
    bolhaResposta.classList.remove('carregando');
  } catch (err) {
    bolhaResposta.textContent = `Não foi possível responder: ${err.message}`;
    bolhaResposta.classList.remove('carregando');
    bolhaResposta.classList.add('erro');
  } finally {
    chatInput.disabled = false;
    chatInput.focus();
  }
}

chatForm?.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const mensagem = chatInput.value.trim();
  if (!mensagem) return;
  chatInput.value = '';
  await enviarMensagemChat(mensagem);
});

// --- Selecionar jogo pra analisar (browse por dia, sem escolher histórico) ---

async function abrirSelecionarJogos(quantidadePadrao, aoConfirmar) {
  const campeonatoId = campeonatoSelect.value;
  if (!campeonatoId) {
    mostrarToast('Escolha um campeonato no topo antes de selecionar jogos.', 'aviso');
    return;
  }

  modalContent.replaceChildren();
  modalBaixarPdfBtn.hidden = true;
  modalVoltarBtn.hidden = true;
  modalVoltarCallback = null;
  const titulo = document.createElement('h2');
  titulo.textContent = 'Selecionar jogo pra analisar';
  modalContent.appendChild(titulo);
  const carregando = document.createElement('p');
  carregando.className = 'config-chat-nota';
  carregando.textContent = 'Carregando jogos agendados...';
  modalContent.appendChild(carregando);
  modalOverlay.classList.add('active');

  try {
    const campeonatos = await fetchJSON('/api/campeonatos');
    const atual = campeonatos.find((c) => String(c.campeonato_id) === String(campeonatoId));
    let numero = atual?.rodada_atual?.rodada;
    if (!numero) throw new Error('Este campeonato não tem rodada atual (pode ser mata-mata).');

    // Uma rodada sozinha às vezes só cobre 2-3 dias - junta os agendados de
    // várias rodadas seguidas (até um limite) pra ter mais dias pra navegar
    // e aproveitar melhor o espaço da tela. Uma rodada que falhar (sem cache
    // e sem cota) não pode travar a busca inteira - tenta a rodada seguinte
    // (numero + 1, já que não temos o proxima_rodada de uma leitura que
    // falhou) em vez de desistir na primeira que der errado.
    const agendados = [];
    let ultimoErro = null;
    let rodadasLidas = 0;
    for (let tentativas = 0; rodadasLidas < 3 && numero && tentativas < 6; tentativas += 1) {
      try {
        const rodada = await fetchJSON(`/api/campeonatos/${campeonatoId}/rodadas/${numero}`);
        (rodada.partidas ?? [])
          .filter((p) => p.status === 'agendado')
          .forEach((p) => agendados.push({ ...p, _numeroRodada: rodada.rodada }));
        numero = rodada.proxima_rodada?.rodada ?? null;
        rodadasLidas += 1;
      } catch (err) {
        ultimoErro = err;
        numero += 1;
      }
    }
    if (agendados.length === 0) throw ultimoErro ?? new Error('Não há jogos agendados nas próximas rodadas.');

    montarPickerSelecaoJogos(campeonatoId, agendados, quantidadePadrao, aoConfirmar);
  } catch (err) {
    carregando.textContent = `Não foi possível abrir a seleção: ${err.message}`;
    carregando.classList.add('erro');
  }
}

function montarPickerSelecaoJogos(campeonatoId, agendados, quantidadePadrao, aoConfirmar) {
  modalContent.replaceChildren();
  modalBaixarPdfBtn.hidden = true;
  modalVoltarBtn.hidden = true;
  modalVoltarCallback = null;
  const titulo = document.createElement('h2');
  titulo.textContent = 'Selecionar jogos pra analisar';
  modalContent.appendChild(titulo);

  const dica = document.createElement('p');
  dica.className = 'config-chat-nota';
  dica.textContent = 'Marque um ou mais jogos - selecionar vários monta uma "múltipla" com a estimativa de cada um, calculada separadamente.';
  modalContent.appendChild(dica);

  // Agrupa os agendados por dia (igual a aba Jogos) pra navegar por
  // "Hoje / Amanhã / Em N dias" mostrando todos os jogos daquele dia. A
  // seleção (Map por partida_id) persiste entre trocas de dia.
  const grupos = new Map();
  agendados.forEach((partida) => {
    const chave = partida.data_realizacao;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(partida);
  });
  const diasChaves = [...grupos.keys()];
  const selecionados = new Map();

  const pillsDias = document.createElement('div');
  pillsDias.className = 'datas-pills selecao-jogos-dias';
  modalContent.appendChild(pillsDias);

  const listaJogosDia = document.createElement('div');
  listaJogosDia.className = 'selecao-jogos-do-dia';
  modalContent.appendChild(listaJogosDia);

  const rodape = document.createElement('div');
  rodape.className = 'selecao-jogos-rodape';
  const contagem = document.createElement('span');
  contagem.className = 'selecao-jogos-contagem';
  const btnConfirmar = document.createElement('button');
  btnConfirmar.type = 'button';
  btnConfirmar.className = 'selecao-jogos-confirmar';
  btnConfirmar.textContent = 'Analisar seleção';
  btnConfirmar.disabled = true;
  rodape.append(contagem, btnConfirmar);
  modalContent.appendChild(rodape);

  const status = document.createElement('p');
  status.className = 'config-chat-nota';
  modalContent.appendChild(status);

  function atualizarContagem() {
    const n = selecionados.size;
    contagem.textContent = n === 0 ? 'Nenhum jogo selecionado' : n === 1 ? '1 jogo selecionado' : `${n} jogos selecionados`;
    btnConfirmar.disabled = n === 0;
  }

  function renderDia(diaChave) {
    pillsDias.querySelectorAll('.data-pill').forEach((p) => p.classList.toggle('active', p.dataset.chave === diaChave));
    listaJogosDia.replaceChildren();

    (grupos.get(diaChave) ?? []).forEach((partida) => {
      const linha = document.createElement('div');
      linha.className = 'jogo-linha selecionavel';
      if (selecionados.has(partida.partida_id)) linha.classList.add('selecionado');
      linha.addEventListener('click', () => {
        if (selecionados.has(partida.partida_id)) {
          selecionados.delete(partida.partida_id);
          linha.classList.remove('selecionado');
        } else {
          selecionados.set(partida.partida_id, partida);
          linha.classList.add('selecionado');
        }
        atualizarContagem();
      });

      const marca = document.createElement('span');
      marca.className = 'selecao-jogos-check';

      const horario = document.createElement('span');
      horario.className = 'horario';
      horario.textContent = partida.hora_realizacao ?? '';

      const confrontos = document.createElement('div');
      confrontos.className = 'confrontos';
      confrontos.appendChild(timeLinhaJogos(partida.time_mandante));
      confrontos.appendChild(timeLinhaJogos(partida.time_visitante));

      linha.append(marca, horario, confrontos);
      listaJogosDia.appendChild(linha);
    });
  }

  diasChaves.forEach((chave) => {
    const dataIso = grupos.get(chave)[0].data_realizacao_iso ?? chave;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'data-pill';
    pill.dataset.chave = chave;
    const rotulo = document.createElement('div');
    rotulo.className = 'pill-rotulo';
    rotulo.textContent = formatarRotuloPill(dataIso);
    const subrotulo = document.createElement('div');
    subrotulo.className = 'pill-data';
    subrotulo.textContent = formatarDataCurta(dataIso);
    pill.append(rotulo, subrotulo);
    pill.addEventListener('click', () => renderDia(chave));
    pillsDias.appendChild(pill);
  });

  btnConfirmar.addEventListener('click', async () => {
    btnConfirmar.disabled = true;
    status.textContent = '';
    status.classList.remove('erro');

    const partidas = [...selecionados.values()];
    const pernas = [];
    let falhas = 0;
    let incompletos = 0;
    let naoTentados = 0;

    // Um jogo de cada vez (não em paralelo) - antes de tentar cada um, confere
    // quanto sobrou da cota. Se ela já zerou por causa de um jogo anterior
    // desta mesma leva, os que restam nem são tentados (evita gastar tempo
    // numa busca que a gente já sabe de antemão que vai ficar pela metade).
    for (let i = 0; i < partidas.length; i += 1) {
      const partida = partidas[i];
      btnConfirmar.textContent = `Analisando ${i + 1} de ${partidas.length}...`;

      const statusApi = await fetchJSON('/api/status').catch(() => null);
      if (statusApi && statusApi.usoApi.hoje >= statusApi.usoApi.limite) {
        naoTentados += partidas.length - i;
        break;
      }

      try {
        const resultado = await fetchJSON('/api/chat/analise-automatica', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeMandanteId: partida.time_mandante.time_id,
            timeVisitanteId: partida.time_visitante.time_id,
            numeroRodada: partida._numeroRodada,
            quantidade: quantidadePadrao,
          }),
        });

        if (resultado.erro) {
          falhas += 1;
        } else if (resultado.incompleto) {
          // Só entram jogos com o histórico 100% completo - um jogo que ficou
          // pela metade porque a cota acabou no meio da busca fica de fora em
          // vez de aparecer com um aviso, a pedido explícito do usuário.
          incompletos += 1;
        } else {
          pernas.push({ partida, resultado });
        }
      } catch {
        falhas += 1;
      }
    }

    if (pernas.length === 0) {
      const partes = [];
      if (naoTentados > 0) partes.push(`${naoTentados} nem foram tentados porque a cota da API já tinha acabado`);
      if (incompletos > 0) partes.push(`${incompletos} ficaram incompletos (cota acabou no meio da busca)`);
      if (falhas > 0) partes.push(`${falhas} não puderam ser analisados`);
      status.textContent = partes.length > 0
        ? `Nenhum jogo com histórico 100% completo - ${partes.join(', ')}.`
        : 'Não foi possível analisar nenhum dos jogos selecionados.';
      status.classList.add('erro');
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Analisar seleção';
      return;
    }

    modalOverlay.classList.remove('active');
    if (falhas > 0 || incompletos > 0 || naoTentados > 0) {
      const partes = [];
      if (naoTentados > 0) partes.push(`${naoTentados} não tentado(s) (cota já esgotada)`);
      if (incompletos > 0) partes.push(`${incompletos} incompleto(s) (cota acabou no meio da busca)`);
      if (falhas > 0) partes.push(`${falhas} não puderam ser analisados`);
      mostrarToast(`${partes.join(', ')} - ficaram de fora.`, 'aviso');
    }
    await aoConfirmar(pernas);
  });

  renderDia(diasChaves[0]);
  atualizarContagem();
}

chatSelecionarBtn?.addEventListener('click', () => {
  const config = carregarConfigChat();
  abrirSelecionarJogos(config.quantidadePadrao, async (pernas) => {
    const nomesJogos = pernas.map((p) => `${p.partida.time_mandante.nome_popular} x ${p.partida.time_visitante.nome_popular}`);
    const blocoDados = pernas
      .map((p, i) => `Jogo ${i + 1} - ${nomesJogos[i]}:\n${JSON.stringify(p.resultado)}`)
      .join('\n\n');
    const mensagem =
      (pernas.length > 1
        ? `Escolhi esses jogos pra analisar (pensando numa múltipla): ${nomesJogos.join(', ')}.`
        : `Escolhi o jogo ${nomesJogos[0]} pra analisar.`) +
      ` Seguem os dados já calculados:\n\nDADOS PRÉ-CALCULADOS:\n${blocoDados}\n\n` +
      `Monte a ficha de análise de cada jogo (vitória/empate/derrota, ambas marcam, mais de 2.5 gols, ` +
      `e as chances mais relevantes) usando só esses números.`;
    await enviarMensagemChat(mensagem, pernas.length > 1 ? `Múltipla: ${nomesJogos.join(', ')}` : `Palpites de ${nomesJogos[0]}`);
  });
});

// --- Jogos Pesquisados (seleção manual guardada, sem IA) ---

const PESQUISADOS_CHAVE = 'esportesAnalyticsJogosPesquisados';
const PESQUISADOS_MAX = 30;

function carregarJogosPesquisados() {
  try {
    const lista = JSON.parse(localStorage.getItem(PESQUISADOS_CHAVE));
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function salvarJogoPesquisado(entrada) {
  const lista = [entrada, ...carregarJogosPesquisados()].slice(0, PESQUISADOS_MAX);
  localStorage.setItem(PESQUISADOS_CHAVE, JSON.stringify(lista));
}

function removerJogoPesquisado(id) {
  const lista = carregarJogosPesquisados().filter((item) => item.id !== id);
  localStorage.setItem(PESQUISADOS_CHAVE, JSON.stringify(lista));
}

function melhorPalpite(probabilidade, nomeMandante, nomeVisitante) {
  const opcoes = [
    { label: nomeMandante, valor: probabilidade.vitoriaMandante },
    { label: 'Empate', valor: probabilidade.empate },
    { label: nomeVisitante, valor: probabilidade.vitoriaVisitante },
  ];
  return opcoes.reduce((melhor, atual) => (atual.valor > melhor.valor ? atual : melhor));
}

// --- Acertômetro: confere a Sugestão salva contra o placar real do jogo ---

function resultadoRealLabel(placarMandante, placarVisitante, nomeMandante, nomeVisitante) {
  if (placarMandante > placarVisitante) return nomeMandante;
  if (placarMandante < placarVisitante) return nomeVisitante;
  return 'Empate';
}

async function conferirResultados() {
  const lista = carregarJogosPesquisados();
  let conferidos = 0;
  let semDadoAinda = 0;

  for (const entrada of lista) {
    const pernas = entrada.pernas ?? [entrada];
    for (const perna of pernas) {
      if (!perna.partidaId || perna.conferido) continue;

      try {
        const info = await fetchJSON(`/api/matches/${perna.partidaId}/resultado`);
        if (info.status !== 'finalizado') {
          semDadoAinda += 1;
          continue;
        }
        const palpite = melhorPalpite(perna.resultado.probabilidade, perna.mandante.nome, perna.visitante.nome);
        const real = resultadoRealLabel(info.placarMandante, info.placarVisitante, perna.mandante.nome, perna.visitante.nome);
        perna.conferido = true;
        perna.placarReal = { mandante: info.placarMandante, visitante: info.placarVisitante };
        perna.acertou = palpite.label === real;
        conferidos += 1;
      } catch {
        // um jogo que falhar (sem cache, cota esgotada) só fica pra tentar de novo depois
      }
    }
  }

  if (conferidos > 0) {
    localStorage.setItem(PESQUISADOS_CHAVE, JSON.stringify(lista));
    renderJogosPesquisados();
  }

  if (conferidos === 0 && semDadoAinda === 0) {
    mostrarToast('Nada novo pra conferir - todos os jogos salvos já foram checados ou ainda não têm partidaId salvo.', 'info');
  } else if (conferidos === 0) {
    mostrarToast(`${semDadoAinda} jogo(s) ainda não terminaram - confere de novo depois.`, 'info');
  } else {
    mostrarToast(`${conferidos} resultado(s) conferido(s)${semDadoAinda > 0 ? `, ${semDadoAinda} ainda não terminaram` : ''}.`, 'info');
  }
}

function renderAcertometro() {
  const lista = carregarJogosPesquisados();
  const pernasConferidas = lista.flatMap((e) => (e.pernas ?? [e])).filter((p) => p.conferido);

  if (pernasConferidas.length === 0) {
    acertometroEl.hidden = true;
    return;
  }

  const acertos = pernasConferidas.filter((p) => p.acertou).length;
  const total = pernasConferidas.length;
  const pct = Math.round((acertos / total) * 100);
  acertometroEl.hidden = false;
  acertometroEl.textContent = `Acertômetro: ${acertos} de ${total} sugestões bateram com o resultado real (${pct}%)`;
}

conferirResultadosBtn?.addEventListener('click', () => {
  conferirResultadosBtn.disabled = true;
  conferirResultadosBtn.textContent = 'Conferindo...';
  conferirResultados().finally(() => {
    conferirResultadosBtn.disabled = false;
    conferirResultadosBtn.textContent = 'Conferir resultados';
  });
});

function criarBlocoChances(nomeTime, chances) {
  const bloco = document.createElement('div');
  bloco.className = 'pesquisado-chances-time';

  const titulo = document.createElement('div');
  titulo.className = 'pesquisado-chances-titulo';
  titulo.textContent = nomeTime;
  bloco.appendChild(titulo);

  const lista = document.createElement('div');
  lista.className = 'alertas-lista';
  chances.forEach(({ label, linha, percentual, sufixo }) => {
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
  bloco.appendChild(lista);

  return bloco;
}

function criarBlocoJogoPesquisado(perna, comTitulo) {
  const { mandante, visitante, resultado } = perna;
  const bloco = document.createElement('div');
  bloco.className = 'pesquisado-jogo';

  if (comTitulo) {
    const tituloJogo = document.createElement('h4');
    tituloJogo.className = 'pesquisado-jogo-titulo';
    tituloJogo.textContent = `${mandante.nome} x ${visitante.nome}`;
    bloco.appendChild(tituloJogo);
  }

  if (resultado.mandante.contexto || resultado.visitante.contexto) {
    const contexto = document.createElement('p');
    contexto.className = 'pesquisado-contexto';
    contexto.textContent = [
      resultado.mandante.contexto ? `${mandante.nome}: ${resultado.mandante.contexto.descricao}` : null,
      resultado.visitante.contexto ? `${visitante.nome}: ${resultado.visitante.contexto.descricao}` : null,
    ]
      .filter(Boolean)
      .join('. ');
    bloco.appendChild(contexto);
  }

  if (resultado.incompleto) {
    const partes = [resultado.mandante, resultado.visitante]
      .map((lado, i) => ({ lado, nome: i === 0 ? mandante.nome : visitante.nome }))
      .filter(({ lado }) => lado.jogosAnalisados < lado.jogosTentados)
      .map(({ lado, nome }) => `${nome} (${lado.jogosAnalisados} de ${lado.jogosTentados})`);
    const aviso = document.createElement('p');
    aviso.className = 'pesquisado-incompleto';
    aviso.textContent =
      `Cota da API acabou no meio da busca: ${partes.join(', ')}. Analisar esse confronto de novo ` +
      `mais tarde completa automaticamente o que faltou.`;
    bloco.appendChild(aviso);
  }

  // Times sem jogos suficientes jogando em casa/fora especificamente caem
  // pro histórico geral (misturando casa+fora) - e amostra pequena (menos
  // de 4 jogos) deixa a estimativa menos confiável. Ambos casos avisados
  // aqui pra não passar confiança maior do que os dados realmente sustentam.
  const ressalvas = [resultado.mandante, resultado.visitante]
    .map((lado, i) => ({ lado, nome: i === 0 ? mandante.nome : visitante.nome }))
    .filter(({ lado }) => lado.mandoEspecifico === false || lado.amostraPequena)
    .map(({ lado, nome }) => {
      const motivos = [];
      if (lado.mandoEspecifico === false) motivos.push('sem jogos suficientes nesse mando, usando histórico geral');
      if (lado.amostraPequena) motivos.push(`amostra pequena (${lado.jogosAnalisados} jogos)`);
      return `${nome} (${motivos.join(', ')})`;
    });
  if (ressalvas.length > 0) {
    const aviso = document.createElement('p');
    aviso.className = 'pesquisado-incompleto';
    aviso.textContent = `${ressalvas.join('; ')}.`;
    bloco.appendChild(aviso);
  }

  bloco.appendChild(criarBarraProbabilidade(mandante.nome, visitante.nome, resultado.probabilidade));

  const palpite = melhorPalpite(resultado.probabilidade, mandante.nome, visitante.nome);
  const linhaSugestao = document.createElement('div');
  linhaSugestao.className = 'pesquisado-sugestao-linha';
  const sugestao = document.createElement('div');
  sugestao.className = 'pesquisado-sugestao';
  sugestao.textContent = `Sugestão: ${palpite.label === 'Empate' ? 'empate' : `vitória de ${palpite.label}`} (${palpite.valor}%)`;
  linhaSugestao.appendChild(sugestao);

  if (perna.conferido) {
    const badge = document.createElement('div');
    badge.className = `pesquisado-resultado ${perna.acertou ? 'acertou' : 'errou'}`;
    badge.textContent = `${perna.acertou ? '✅ Acertou' : '❌ Errou'} - ${perna.placarReal.mandante} x ${perna.placarReal.visitante}`;
    linhaSugestao.appendChild(badge);
  }
  bloco.appendChild(linhaSugestao);

  bloco.append(
    criarBlocoChances(mandante.nome, resultado.mandante.chances),
    criarBlocoChances(visitante.nome, resultado.visitante.chances),
  );

  return bloco;
}

function criarCardPesquisado(entrada) {
  // Entradas antigas (salvas antes da múltipla) tinham um único jogo direto
  // no objeto - normaliza pra sempre trabalhar com um array de "pernas".
  const pernas = entrada.pernas ?? [
    { mandante: entrada.mandante, visitante: entrada.visitante, data: entrada.data, resultado: entrada.resultado },
  ];

  const card = document.createElement('div');
  card.className = 'pesquisado-card';

  const cabecalho = document.createElement('div');
  cabecalho.className = 'pesquisado-cabecalho';
  const titulo = document.createElement('div');
  titulo.className = 'pesquisado-titulo';
  titulo.textContent =
    pernas.length > 1 ? `Múltipla de ${pernas.length} jogos` : `${pernas[0].mandante.nome} x ${pernas[0].visitante.nome}`;
  const acoes = document.createElement('div');
  acoes.className = 'pesquisado-acoes-card';

  const btnCompartilhar = document.createElement('button');
  btnCompartilhar.className = 'pesquisado-icone-btn';
  btnCompartilhar.type = 'button';
  btnCompartilhar.title = 'Compartilhar como imagem';
  btnCompartilhar.textContent = '📤';
  btnCompartilhar.addEventListener('click', () => compartilharCard(card, titulo.textContent));

  const btnRemover = document.createElement('button');
  btnRemover.className = 'pesquisado-icone-btn pesquisado-remover';
  btnRemover.type = 'button';
  btnRemover.title = 'Remover';
  btnRemover.textContent = '×';
  btnRemover.addEventListener('click', () => {
    removerJogoPesquisado(entrada.id);
    renderJogosPesquisados();
  });

  acoes.append(btnCompartilhar, btnRemover);
  cabecalho.append(titulo, acoes);
  card.appendChild(cabecalho);

  const meta = document.createElement('p');
  meta.className = 'pesquisado-meta';
  const dataHora = new Date(entrada.criadoEm).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  meta.textContent =
    pernas.length > 1
      ? `Pesquisado em ${dataHora}`
      : `Jogo em ${formatarDataCurta(pernas[0].data)} · pesquisado em ${dataHora}`;
  card.appendChild(meta);

  pernas.forEach((perna) => card.appendChild(criarBlocoJogoPesquisado(perna, pernas.length > 1)));

  return card;
}

function renderJogosPesquisados() {
  const lista = carregarJogosPesquisados();
  renderAcertometro();
  pesquisadosLista.replaceChildren();
  if (lista.length === 0) {
    pesquisadosLista.appendChild(linhaVazia('Nenhum jogo pesquisado ainda - use o 🗂️ na aba Jogos ou no Chat.'));
    return;
  }
  lista.forEach((entrada) => pesquisadosLista.appendChild(criarCardPesquisado(entrada)));
}

// --- Compartilhar um card como imagem (ex: mandar no zap) ---

async function compartilharCard(elementoCard, nomeArquivo) {
  if (typeof html2canvas !== 'function') {
    mostrarToast('Não foi possível gerar a imagem agora (biblioteca não carregou).', 'aviso');
    return;
  }

  const acoes = elementoCard.querySelector('.pesquisado-acoes-card');
  acoes.style.visibility = 'hidden';
  let canvas;
  try {
    canvas = await html2canvas(elementoCard, { backgroundColor: '#101a2b', scale: 2 });
  } catch {
    mostrarToast('Não foi possível gerar a imagem desse card.', 'aviso');
    return;
  } finally {
    acoes.style.visibility = '';
  }

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const nomeArquivoLimpo = `${nomeArquivo.replace(/[^\w\s-]/g, '')}.png`;
    const arquivo = new File([blob], nomeArquivoLimpo, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], title: nomeArquivo });
        return;
      } catch {
        // usuário cancelou o compartilhamento ou o navegador recusou - cai pro download
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivoLimpo;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// --- Baixar o conteúdo do modal (estatísticas, comparativo) como PDF ---

async function baixarComoPDF(elemento, nomeArquivo) {
  if (typeof html2canvas !== 'function' || typeof jspdf === 'undefined') {
    mostrarToast('Não foi possível gerar o PDF agora (biblioteca não carregou).', 'aviso');
    return;
  }

  let canvas;
  try {
    canvas = await html2canvas(elemento, { backgroundColor: '#101a2b', scale: 2 });
  } catch {
    mostrarToast('Não foi possível gerar o PDF agora.', 'aviso');
    return;
  }

  const { jsPDF } = jspdf;
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(`${nomeArquivo.replace(/[^\w\s-]/g, '')}.pdf`);
}

function habilitarBaixarPdf(nomeArquivo) {
  modalBaixarPdfBtn.hidden = false;
  modalBaixarPdfBtn.onclick = () => baixarComoPDF(modalContent, nomeArquivo);
}

// --- Aviso "faltam 30 min" pros jogos salvos ---
//
// Só funciona com o app aberto (aba ou PWA rodando) - notificação de
// verdade com o app fechado exigiria service worker + push do servidor,
// o que não é confiável num plano free que dorme sozinho (Render). Isso
// aqui é um aviso local, checado a cada minuto enquanto o app está aberto.

const NOTIFICACOES_ATIVAS_CHAVE = 'esportesAnalyticsNotificacoesAtivas';
const NOTIFICADOS_CHAVE = 'esportesAnalyticsNotificados';
const MINUTOS_ANTES_AVISO = 30;
let intervaloLembretes = null;

function notificacoesAtivas() {
  return localStorage.getItem(NOTIFICACOES_ATIVAS_CHAVE) === 'true';
}

function carregarNotificados() {
  try {
    const lista = JSON.parse(localStorage.getItem(NOTIFICADOS_CHAVE));
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function marcarNotificado(partidaId) {
  const lista = carregarNotificados();
  lista.push(partidaId);
  localStorage.setItem(NOTIFICADOS_CHAVE, JSON.stringify(lista.slice(-200)));
}

function verificarLembretes() {
  if (!notificacoesAtivas() || Notification.permission !== 'granted') return;

  const jaNotificados = new Set(carregarNotificados());
  const agora = Date.now();
  const lista = carregarJogosPesquisados();

  lista.forEach((entrada) => {
    (entrada.pernas ?? [entrada]).forEach((perna) => {
      if (!perna.partidaId || !perna.data || jaNotificados.has(perna.partidaId)) return;
      const minutosParaComecar = (new Date(perna.data).getTime() - agora) / 60000;
      if (minutosParaComecar > 0 && minutosParaComecar <= MINUTOS_ANTES_AVISO) {
        new Notification('Faltam 30 min', {
          body: `${perna.mandante.nome} x ${perna.visitante.nome} começa daqui a pouco.`,
          icon: '/icon.svg',
        });
        marcarNotificado(perna.partidaId);
      }
    });
  });
}

function atualizarBotaoNotificar() {
  if (!notificarBtn) return;
  const ativo = notificacoesAtivas() && Notification?.permission === 'granted';
  notificarBtn.textContent = ativo ? 'Avisos ativados' : 'Avisar 30 min antes';
  notificarBtn.classList.toggle('ativo', ativo);
}

function iniciarChecagemLembretes() {
  if (intervaloLembretes) return;
  verificarLembretes();
  intervaloLembretes = setInterval(verificarLembretes, 60 * 1000);
}

notificarBtn?.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    mostrarToast('Esse navegador não suporta notificações.', 'aviso');
    return;
  }

  if (notificacoesAtivas()) {
    localStorage.setItem(NOTIFICACOES_ATIVAS_CHAVE, 'false');
    atualizarBotaoNotificar();
    mostrarToast('Avisos desativados.', 'info');
    return;
  }

  const permissao = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permissao !== 'granted') {
    mostrarToast('Permissão de notificação negada pelo navegador.', 'aviso');
    return;
  }

  localStorage.setItem(NOTIFICACOES_ATIVAS_CHAVE, 'true');
  atualizarBotaoNotificar();
  iniciarChecagemLembretes();
  mostrarToast('Avisos ativados - só funciona com o app aberto.', 'info');
});

if ('Notification' in window && notificacoesAtivas() && Notification.permission === 'granted') {
  iniciarChecagemLembretes();
}
atualizarBotaoNotificar();

jogosSelecionarBtn?.addEventListener('click', () => {
  abrirSelecionarJogos(Number(quantidadeSelect.value), async (pernas) => {
    const entrada = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      criadoEm: new Date().toISOString(),
      pernas: pernas.map((p) => ({
        partidaId: p.partida.partida_id,
        data: p.partida.data_realizacao_iso ?? p.partida.data_realizacao,
        mandante: { id: p.partida.time_mandante.time_id, nome: p.partida.time_mandante.nome_popular },
        visitante: { id: p.partida.time_visitante.time_id, nome: p.partida.time_visitante.nome_popular },
        resultado: p.resultado,
      })),
    };
    salvarJogoPesquisado(entrada);
    renderJogosPesquisados();
    mostrarToast(
      pernas.length > 1 ? `Múltipla de ${pernas.length} jogos salva em "Jogos Pesquisados".` : 'Análise salva em "Jogos Pesquisados".',
      'info',
    );
    document.querySelector('.tab-btn[data-tab="pesquisados"]')?.click();
  });
});

async function iniciar() {
  carregarUsoApi();
  renderJogosPesquisados();
  const temCampeonatos = await carregarCampeonatosSelect();
  if (temCampeonatos) carregarJogos();
}

iniciar();
