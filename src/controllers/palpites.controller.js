import { gerarPalpites } from '../services/motorPalpites.js';

export async function confronto(req, res, next) {
  try {
    const { campeonato, mandante, visitante, rodada } = req.query;
    if (!campeonato || !mandante || !visitante || !rodada) {
      return res.status(400).json({
        error: 'Parâmetros "campeonato", "mandante", "visitante" e "rodada" são obrigatórios',
      });
    }

    const resultado = await gerarPalpites(
      Number(campeonato),
      Number(mandante),
      Number(visitante),
      Number(rodada),
    );

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}
