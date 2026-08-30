import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const PORT = process.env.PORT || 3000;
export const API_FUTEBOL_KEY = process.env.API_FUTEBOL_KEY;
export const API_FUTEBOL_BASE_URL = 'https://api.api-futebol.com.br/v1';

if (!API_FUTEBOL_KEY) {
  console.warn('Aviso: API_FUTEBOL_KEY nao foi definida no .env');
}
