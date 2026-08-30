import { buscarFormaTime } from '../services/formaService.js';

export async function forma(req, res, next) {
  try {
    const { timeId } = req.params;
    const { campeonato, antes, quantidade } = req.query;

    if (!campeonato || !antes) {
      return res.status(400).json({ error: 'Parâmetros "campeonato" e "antes" (número da rodada) são obrigatórios' });
    }

    const resultado = await buscarFormaTime(
      Number(campeonato),
      Number(timeId),
      Number(antes),
      quantidade ? Number(quantidade) : 5,
    );

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}
