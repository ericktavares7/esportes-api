import { gerarPalpites } from '../services/motorPalpites.js';
import { relatorioAuditoria } from '../services/auditoriaPalpites.js';

export async function auditoria(req, res, next) {
  try {
    res.json(await relatorioAuditoria());
  } catch (err) {
    next(err);
  }
}

// campeonato_id e time_id são numéricos na API Futebol, mas a Série A
// (fonte GOAL API, ver [[project-serie-a-test]]) usa ids que não são número
// ("goal-serie-a", e time_id em formato cuid tipo "cmr7ben..."). Converte só
// quando o valor É de fato numérico; senão mantém a string original.
function paraNumeroOuTexto(valor) {
  const numero = Number(valor);
  return Number.isNaN(numero) ? valor : numero;
}

export async function confronto(req, res, next) {
  try {
    const { campeonato, mandante, visitante, rodada } = req.query;
    if (!campeonato || !mandante || !visitante || !rodada) {
      return res.status(400).json({
        error: 'Parâmetros "campeonato", "mandante", "visitante" e "rodada" são obrigatórios',
      });
    }

    const resultado = await gerarPalpites(
      paraNumeroOuTexto(campeonato),
      paraNumeroOuTexto(mandante),
      paraNumeroOuTexto(visitante),
      Number(rodada),
    );

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}
