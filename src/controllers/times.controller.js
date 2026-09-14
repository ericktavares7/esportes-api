import { buscarFormaTime, buscarFormaComMando } from '../services/formaService.js';

// campeonato_id e time_id são numéricos na API Futebol, mas a Série A
// (fonte GOAL API, ver [[project-serie-a-test]]) usa ids que não são número
// ("goal-serie-a", e time_id em formato cuid tipo "cmr7ben..."). Converte só
// quando o valor É de fato numérico; senão mantém a string original.
function paraNumeroOuTexto(valor) {
  const numero = Number(valor);
  return Number.isNaN(numero) ? valor : numero;
}

export async function forma(req, res, next) {
  try {
    const { timeId } = req.params;
    const { campeonato, antes, quantidade, mando } = req.query;

    if (!campeonato || !antes) {
      return res.status(400).json({ error: 'Parâmetros "campeonato" e "antes" (número da rodada) são obrigatórios' });
    }

    const campeonatoId = paraNumeroOuTexto(campeonato);
    const timeIdResolvido = paraNumeroOuTexto(timeId);
    const q = quantidade ? Number(quantidade) : 5;

    // mando=casa/fora é opcional - quem pede um confronto específico (o
    // comparativo pré-jogo) passa isso pra nunca misturar jogos em casa com
    // jogos fora; quem só quer o perfil geral do time (aba Tabela) não passa
    // nada e continua recebendo o histórico misturado, como sempre.
    if (mando === 'casa' || mando === 'fora') {
      const resultado = await buscarFormaComMando(campeonatoId, timeIdResolvido, Number(antes), q, mando === 'casa');
      return res.json(resultado);
    }

    const resultado = await buscarFormaTime(campeonatoId, timeIdResolvido, Number(antes), q);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}
