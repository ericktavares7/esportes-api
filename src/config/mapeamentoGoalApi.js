// Mapeamento manual entre o time_id da API Futebol e o id de time da GOAL
// API, só pros 20 times da Série B 2026. Os nomes variam um pouco entre as
// duas fontes ("Sport" x "Sport Recife", "Botafogo-SP" x "Botafogo SP",
// "América-MG" x "América Mineiro" etc.) - por isso um mapeamento fixo é bem
// mais confiável que tentar casar por nome toda hora. Escantios/cartões desse
// time_id vêm da GOAL API quando disponível (ver goalApiService.js); o resto
// dos dados do time continua vindo da API Futebol normalmente.
//
// Precisa ser atualizado se a Série B trocar de time (acesso/rebaixamento) na
// próxima temporada - times novos ficam sem mapeamento até serem adicionados
// aqui, e nesse caso o app cai pro dado da API Futebol sem quebrar nada.
export const MAPEAMENTO_TIMES_GOAL_API = {
  51: 'cmr7wu05o9kv8rx06adgq24rg', // Novorizontino
  43: 'cmr7wu05i9kv6rx06r5doed0a', // Juventude
  131: 'cmr7wu05x9kvfrx06oqpcciea', // Fortaleza
  110: 'cmr7wu0649kvlrx06fkp8yv5z', // Vila Nova
  1: 'cmr7wu0669kvmrx06zpdn1bqf', // Criciúma
  98: 'cmr7wu05z9kvhrx06ikryezl3', // Atlético-GO
  117: 'cmr7wu05w9kverx06sb8ozy6w', // Operário-PR
  90: 'cmr7wu0609kvirx06kek1bg62', // CRB
  79: 'cmr7wu05u9kvcrx066idvr5pd', // Sport
  214: 'cmr7wu05r9kvarx065yddbjdc', // Athletic Club
  204: 'cmr7wu05k9kv7rx065nhnpf6v', // Cuiabá
  74: 'cmr7wu0639kvkrx06ls825ddy', // Náutico
  115: 'cmr7wu0619kvjrx067mtep8bz', // Goiás
  402: 'cmr7wu05v9kvdrx06qn8kof5c', // São Bernardo
  105: 'cmr7wu05s9kvbrx06tgtblb2u', // Ceará
  66: 'cmr7wu06d9kvprx062mx0mvyk', // Botafogo-SP
  6: 'cmr7wu05y9kvgrx06o72ujuek', // Avaí
  71: 'cmrkx1h3w0rg3ml07nfcb5qes', // Londrina
  33: 'cmr7wu05g9kv5rx06i0npuyuf', // América-MG
  61: 'cmr7wu05p9kv9rx06eo6z5maa', // Ponte Preta
};
