import axios from 'axios';
import { API_FUTEBOL_KEY, API_FUTEBOL_BASE_URL } from '../config/env.js';

// Cliente axios pre-configurado: toda chamada feita com "api" ja sai
// com a URL base e o token de autenticacao certos, sem repetir codigo.
const api = axios.create({
  baseURL: API_FUTEBOL_BASE_URL,
  headers: {
    Authorization: `Bearer ${API_FUTEBOL_KEY}`,
  },
});

export async function getCampeonatos() {
  const { data } = await api.get('/campeonatos');
  return data;
}

export async function getTabela(campeonatoId) {
  const { data } = await api.get(`/campeonatos/${campeonatoId}/tabela`);
  return data;
}

export async function getArtilharia(campeonatoId) {
  const { data } = await api.get(`/campeonatos/${campeonatoId}/artilharia`);
  return data;
}

export async function getRodadas(campeonatoId) {
  const { data } = await api.get(`/campeonatos/${campeonatoId}/rodadas`);
  return data;
}

export async function getRodada(campeonatoId, numero) {
  const { data } = await api.get(`/campeonatos/${campeonatoId}/rodadas/${numero}`);
  return data;
}

export async function getAoVivo() {
  const { data } = await api.get('/ao-vivo');
  return data;
}

export async function getPartida(partidaId) {
  const { data } = await api.get(`/partidas/${partidaId}`);
  return data;
}
