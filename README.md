# API de Esportes

API em Node.js/Express que busca dados de jogos de futebol brasileiro (partidas, estatísticas,
escalações e resumos) a partir da [API Futebol](https://api-futebol.com.br/).

## Configuração

1. Crie uma conta gratuita em https://dash.api-futebol.com.br
2. No painel, copie sua API Key (a `test_...`, pra desenvolver sem gastar o plano; troque pela `live_...` quando for pra produção)
3. Copie `.env.example` para `.env` e cole a chave:
   ```
   PORT=3000
   API_FUTEBOL_KEY=sua_chave_aqui
   ```
4. Instale as dependências: `npm install`
5. Rode em modo desenvolvimento (reinicia sozinho a cada alteração): `npm run dev`

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Página web que consome a API (jogos por data, tabela, ao vivo, artilharia) |
| GET | `/api/status` | Health check |
| GET | `/api/campeonatos` | Lista campeonatos disponíveis (traz o `campeonato_id` de cada um) |
| GET | `/api/campeonatos/:id/tabela` | Classificação do campeonato |
| GET | `/api/campeonatos/:id/artilharia` | Ranking de artilheiros |
| GET | `/api/campeonatos/:id/rodadas` | Lista as rodadas do campeonato |
| GET | `/api/campeonatos/:id/rodadas/:numero` | Jogos de uma rodada específica |
| GET | `/api/matches/live` | Jogos acontecendo agora |
| GET | `/api/matches/:id/summary` | Resumo completo de um jogo: placar, gols, cartões, substituições, escalações e estatísticas |
| GET | `/api/times/:timeId/forma?campeonato=X&antes=Y&quantidade=5` | Últimos N jogos encerrados do time antes da rodada Y: resultados e médias (gols, escanteios, finalizações, chutes no gol, faltas, posse de bola) |

No ambiente de testes (chave `test_...`), os campeonatos disponíveis são: Brasileirão (`id 10`), Copa do Brasil (`id 2`) e Libertadores (`id 7`). Copa do Brasil e Libertadores são mata-mata, então `/rodadas` retorna vazio pra elas (não têm rodadas sequenciais).

**Observação sobre o ambiente de testes:** o endpoint `/partidas/:id` ignora o ID passado e sempre devolve o mesmo jogo fictício (Atlético-MG x Palmeiras), então clicar em jogos diferentes na tela sempre abre o mesmo resumo. Isso é uma limitação da chave `test_`, não um bug do projeto — com a chave `live_` cada ID retorna os dados reais daquela partida.

## Comparativo pré-jogo (aba Jogos)

Ao clicar num jogo com status `agendado`, a página abre um comparativo lado a lado dos últimos N jogos (5/10/15, escolhido no seletor "Últimos N jogos" do topo) dos dois times:

- Tag de posição/pontos/zona na tabela + até 2 rótulos curtos de estilo de jogo (ex: "Contra-ataque", "Ataque volumoso"), derivados das médias com limiares fixos documentados em `sinaisPerfil()` no [script.js](public/script.js)
- Últimos resultados (bolinha verde = vitória, cinza = empate, vermelha = derrota)
- Médias comparadas em pílulas (posse de bola, gols, finalizações, chutes no gol, escanteios, impedimentos, faltas, cartões amarelos — a maior média de cada estatística fica destacada)
- **Estimativa estatística**: probabilidade de vitória/empate/derrota calculada com um modelo de Poisson simplificado (gols esperados = média de gols pró de um time combinada com a média de gols sofridos do outro). É um modelo real e transparente — a fórmula e os "gols esperados" ficam visíveis — mas continua sendo uma estimativa a partir de poucos jogos, **não uma garantia de resultado**. O projeto não implementa nem vai implementar apostas ou qualquer manipulação de dinheiro.

## Estrutura do projeto

```
src/
  config/env.js                    variáveis de ambiente
  services/apiFutebolService.js    chamadas HTTP à API Futebol
  services/formaService.js         calcula a forma recente (últimos N jogos) de um time
  controllers/matches.controller.js      lógica das rotas de partidas
  controllers/campeonatos.controller.js  lógica das rotas de campeonatos
  controllers/times.controller.js        lógica da rota de forma recente
  routes/matches.routes.js         definição das rotas de partidas
  routes/campeonatos.routes.js     definição das rotas de campeonatos
  routes/times.routes.js           definição da rota de forma recente
  app.js                           configuração do Express
  server.js                        ponto de entrada (sobe o servidor)
```
