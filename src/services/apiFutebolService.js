import axios from 'axios';
import { API_FUTEBOL_KEY, API_FUTEBOL_BASE_URL } from '../config/env.js';
import { comCache } from '../db/cache.js';

// A API Futebol NÃO é mais fonte de dados do app - tudo (jogos, tabela,
// artilharia, estatísticas, ao vivo) vem da GOAL API (goalApiService.js).
// Sobrou só isso: abrir/conferir jogos antigos que alguém salvou em "Jogos
// pesquisados" antes da migração, quando o id da partida ainda era o número
// da API Futebol. Sem essa chave configurada, esses jogos antigos deixam de
// abrir - o resto do app não é afetado.
const api = axios.create({
  baseURL: API_FUTEBOL_BASE_URL,
  headers: {
    Authorization: `Bearer ${API_FUTEBOL_KEY}`,
  },
});

const UMA_HORA = 60 * 60;
const UM_ANO = 365 * 24 * UMA_HORA;

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
