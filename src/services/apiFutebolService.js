import axios from 'axios';
import { API_FUTEBOL_KEY, API_FUTEBOL_BASE_URL } from '../config/env.js';
import { comCache } from '../db/cache.js';

// Cliente axios pre-configurado: toda chamada feita com "api" ja sai
// com a URL base e o token de autenticacao certos, sem repetir codigo.
const api = axios.create({
  baseURL: API_FUTEBOL_BASE_URL,
  headers: {
    Authorization: `Bearer ${API_FUTEBOL_KEY}`,
  },
});

// TTLs pensados pra cada tipo de dado: coisas que quase nao mudam (lista de
// campeonatos) ficam em cache por muito tempo; coisas ao vivo, por poucos
// segundos - o mesmo equilibrio que a documentacao da API Futebol recomenda.
const UM_MINUTO = 60;
const UMA_HORA = 60 * 60;
const UM_ANO = 365 * 24 * UMA_HORA;

export async function getCampeonatos() {
  return comCache('campeonatos', 24 * UMA_HORA, async () => {
    const { data } = await api.get('/campeonatos');
    return data;
  });
}

// /me traz os dados da conta, incluindo a lista de campeonatos que o plano
// atual realmente libera (diferente de /campeonatos, que lista o catalogo
// inteiro da API, tenha ou nao acesso).
export async function getMinhaConta() {
  return comCache('minha-conta', UMA_HORA, async () => {
    const { data } = await api.get('/me');
    return data;
  });
}

export async function getTabela(campeonatoId) {
  return comCache(`tabela:${campeonatoId}`, UMA_HORA, async () => {
    const { data } = await api.get(`/campeonatos/${campeonatoId}/tabela`);
    return data;
  });
}

export async function getArtilharia(campeonatoId) {
  return comCache(`artilharia:${campeonatoId}`, UMA_HORA, async () => {
    const { data } = await api.get(`/campeonatos/${campeonatoId}/artilharia`);
    return data;
  });
}

export async function getRodadas(campeonatoId) {
  return comCache(`rodadas:${campeonatoId}`, 6 * UMA_HORA, async () => {
    const { data } = await api.get(`/campeonatos/${campeonatoId}/rodadas`);
    return data;
  });
}

export async function getRodada(campeonatoId, numero) {
  return comCache(
    `rodada:${campeonatoId}:${numero}`,
    // Rodada encerrada nao muda mais - guarda "pra sempre". Enquanto ainda
    // tiver jogo agendado/ao vivo, mantem prazo curto pra pegar atualizacoes.
    (rodada) => (rodada.status === 'encerrada' ? UM_ANO : 5 * UM_MINUTO),
    async () => {
      const { data } = await api.get(`/campeonatos/${campeonatoId}/rodadas/${numero}`);
      return data;
    },
  );
}

export async function getAoVivo() {
  return comCache('ao-vivo', 20, async () => {
    const { data } = await api.get('/ao-vivo');
    return data;
  });
}

export async function getPartida(partidaId) {
  return comCache(
    `partida:${partidaId}`,
    // Jogo finalizado nao muda mais - guarda "pra sempre". Ao vivo pede
    // atualizacao frequente; agendado muda pouco (so se remarcar horario).
    (partida) => {
      if (partida.status === 'finalizado') return UM_ANO;
      if (partida.status === 'andamento') return 20;
      return UMA_HORA;
    },
    async () => {
      const { data } = await api.get(`/partidas/${partidaId}`);
      return data;
    },
  );
}
