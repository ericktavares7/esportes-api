# Esportes Analytics

API em Node.js/Express que busca dados de jogos de futebol brasileiro (partidas, estatísticas,
escalações e resumos) a partir da [API Futebol](https://api-futebol.com.br/).

**Em produção:** https://esportes-api.onrender.com (hospedado no Render, plano free — a primeira
requisição depois de um tempo sem acesso pode demorar ~30-50s pra "acordar" o serviço, e o cache
SQLite é reiniciado a cada deploy porque o disco do plano free é temporário).

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
| GET | `/api/campeonatos` | Lista só os campeonatos que o plano da sua chave realmente libera (cruza o catálogo completo da API com `/me`) |
| GET | `/api/campeonatos/:id/tabela` | Classificação do campeonato |
| GET | `/api/campeonatos/:id/artilharia` | Ranking de artilheiros |
| GET | `/api/campeonatos/:id/rodadas` | Lista as rodadas do campeonato |
| GET | `/api/campeonatos/:id/rodadas/:numero` | Jogos de uma rodada específica |
| GET | `/api/matches/live` | Jogos acontecendo agora |
| GET | `/api/matches/:id/summary` | Resumo completo de um jogo: placar, gols, cartões, substituições, escalações e estatísticas |
| GET | `/api/times/:timeId/forma?campeonato=X&antes=Y&quantidade=5` | Últimos N jogos encerrados do time antes da rodada Y: resultados e médias (gols, escanteios, finalizações, chutes no gol, faltas, posse de bola) |

No ambiente de testes (chave `test_...`), os campeonatos disponíveis são: Brasileirão (`id 10`), Copa do Brasil (`id 2`) e Libertadores (`id 7`). Copa do Brasil e Libertadores são mata-mata, então `/rodadas` retorna vazio pra elas (não têm rodadas sequenciais).

**Observação sobre o ambiente de testes:** o endpoint `/partidas/:id` ignora o ID passado e sempre devolve o mesmo jogo fictício (Atlético-MG x Palmeiras), então clicar em jogos diferentes na tela sempre abre o mesmo resumo. Isso é uma limitação da chave `test_`, não um bug do projeto — com a chave `live_` cada ID retorna os dados reais daquela partida.

## Resiliência quando a cota da API acaba

Três coisas trabalham juntas pra evitar que a tela quebre quando a cota diária (100/dia no plano atual) estoura:

- **Cache "stale" como reserva** (`comCache` em [src/db/cache.js](src/db/cache.js)): se uma chamada real falha mas existe uma cópia antiga (vencida) salva, ela é usada em vez de propagar o erro. Um dado de horas atrás é melhor que nenhum dado. Só propaga erro quando aquela chave **nunca** foi buscada com sucesso.
- **Contador de uso** (`usoApiHoje()`): conta só as chamadas que de fato saíram pra rede (HIT de cache não conta), reiniciando a cada dia. Aparece como badge no topo (`GET /api/status`) e fica amarelo a partir de 50% de uso, vermelho a partir de 90%. A API Futebol não expõe isso via header, então é uma contagem própria — o placar zera quando o servidor conta do zero, não necessariamente sincronizado com o reset real da API (que também não é documentado).
- **Toast em vez de tela travada**: quando uma chamada falha por cota esgotada e não tem nem cache velho pra usar, aparece um aviso pequeno no canto (`mostrarToast`) em vez de qualquer coisa tomando a tela inteira. O texto não cita horário de reset porque a API não informa isso em lugar nenhum.

## Comparativo pré-jogo (aba Jogos)

Ao clicar num jogo com status `agendado`, a página abre um comparativo lado a lado dos últimos N jogos (5/10/15, escolhido no seletor "Últimos N jogos" do topo) dos dois times:

- Tag de posição/pontos/zona na tabela + até 2 rótulos curtos de estilo de jogo (ex: "Contra-ataque", "Ataque volumoso"), derivados das médias com limiares fixos documentados em `sinaisPerfil()` no [script.js](public/script.js)
- Últimos resultados (bolinha verde = vitória, cinza = empate, vermelha = derrota)
- **Abas por time** (`secaoDetalheTimes`): escolhe um dos dois times e mostra o perfil individual dele — médias do período, Top 5 atuações e as "Chances" (ver abaixo) — sem sair do modal. Clique no outro time pra trocar.
- **Estimativa estatística**: probabilidade de vitória/empate/derrota calculada com um modelo de Poisson simplificado (gols esperados = média de gols pró de um time combinada com a média de gols sofridos do outro).

### Chances (over/under por estatística)

Em "Perfil do time" e dentro das abas do comparativo, cada time mostra chips como *"Escanteios > 6.5 → 60%"* pra 9 estatísticas: escanteios, chutes no gol, finalizações, faltas cometidas, cartões amarelos, impedimentos, gols marcados, gols sofridos e posse de bola. A linha vem da própria média do time (arredondada pra baixo + 0.5, o formato usual de mercados over/under), e a porcentagem é a frequência real — quantos dos últimos N jogos passaram dessa linha. É contagem simples sobre jogos que já aconteceram (`ALERTA_CATEGORIAS`/`calcularAlertas` no [script.js](public/script.js)), não uma distribuição estatística projetada.

O projeto é de uso pessoal e não implementa nem vai implementar apostas ou qualquer manipulação de dinheiro — os textos de "não é garantia de resultado" foram removidos das telas a pedido do dono do projeto, mas a natureza dos números (estimativa a partir de poucos jogos) continua a mesma.

## Perfil do time (aba Tabela)

Ao clicar num time na tabela de classificação, abre um histórico completo dele:

- Tag de posição/zona + résultados recentes (mesmos componentes do comparativo pré-jogo)
- Médias no período (posse, gols, finalizações, escanteios, faltas, cartões)
- **Top 5 atuações** (`<details>` recolhido por padrão — clique pra expandir): pra cada estatística (chutes no gol, gols marcados, faltas cometidas, escanteios, cartões amarelos), lista os 5 jogos do período em que o time teve o maior número naquela estatística, com o adversário e o valor
- **Chances**: chips de frequência over/under por estatística (ver seção acima)
- **Próximo jogo**: se o time tiver uma partida `agendado` na rodada atual, mostra a mesma estimativa de probabilidade (Poisson) do comparativo pré-jogo, já calculada contra aquele adversário específico

Tudo montado a partir dos mesmos endpoints já existentes (`/api/times/:id/forma`, `/api/campeonatos/:id/tabela`, `/api/campeonatos/:id/rodadas/:numero`) — nenhuma rota nova no backend.

## Cache local (SQLite)

Toda chamada à API Futebol passa primeiro por um cache em SQLite (`data/cache.sqlite`, criado automaticamente — usa o módulo `node:sqlite` nativo do Node, sem dependência extra). Padrão "cache-aside": se já existe uma cópia válida no banco, ela é usada; senão, busca na API real e salva com um prazo de validade.

| Dado | Validade |
|---|---|
| Lista de campeonatos | 24 horas |
| Tabela / artilharia | 1 hora |
| Lista de rodadas | 6 horas |
| Detalhe de uma rodada | **1 ano** se `status: encerrada` (não muda mais), senão 5 minutos |
| Jogos ao vivo | 20 segundos |
| Detalhe de uma partida | **1 ano** se `status: finalizado`, 20s se `andamento`, 1 hora se `agendado` |
| Forma recente de um time (agregado) | 30 minutos |

O TTL de rodada e de partida é dinâmico: depende do `status` que a própria API devolve, não é um prazo fixo (ver `comCache` em [src/db/cache.js](src/db/cache.js), que aceita tanto um número de segundos quanto uma função `(dados) => segundos`). Isso significa que jogos e rodadas já encerrados ficam salvos essencialmente pra sempre, e consultar o mesmo time semanas depois não gasta cota nenhuma pros jogos que já aconteceram — só os dados que ainda podem mudar (jogo ao vivo, jogo agendado) são buscados de novo.

Isso reduz muito o consumo da cota diária da API — essencial no plano Free (100 requisições/dia), já que o comparativo pré-jogo sozinho pode gerar dezenas de chamadas na primeira vez que é aberto. O terminal mostra `[cache] HIT`/`[cache] MISS` a cada chamada, pra acompanhar o que está vindo do cache. A pasta `data/` não vai pro Git (é gerada localmente).

## Estrutura do projeto

```
src/
  config/env.js                    variáveis de ambiente
  db/cache.js                      cache local em SQLite (padrão cache-aside)
  services/apiFutebolService.js    chamadas HTTP à API Futebol (passam pelo cache)
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
