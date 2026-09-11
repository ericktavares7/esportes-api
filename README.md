# Sport Analytics

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
   As variáveis de IA (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` + seus respectivos
   `_MODEL`) são opcionais - servem só de fallback no servidor. O normal é configurar a chave direto
   pela engrenagem (⚙️) da aba **Chat**, que fica salva só no navegador (ver seção Chat abaixo).
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
| GET | `/api/matches/:id/resultado` | Só status + placar de uma partida - usado pelo Acertômetro pra conferir se a Sugestão salva bateu com o resultado real |
| GET | `/api/times/:timeId/forma?campeonato=X&antes=Y&quantidade=5` | Últimos N jogos encerrados do time antes da rodada Y: resultados e médias (gols, escanteios, finalizações, chutes no gol, faltas, posse de bola) |
| POST | `/api/chat` | `{ mensagem, historico?, provedor?, apiKey?, modelo?, quantidadePadrao? }` → assistente (Claude/ChatGPT/Gemini) que responde perguntas sobre confrontos usando dados reais das outras rotas (ver seção Chat abaixo) |
| POST | `/api/chat/analise-automatica` | `{ timeMandanteId, timeVisitanteId, numeroRodada, quantidade? }` → calcula o mesmo resultado de `analisar_confronto` (probabilidade + Chances) sem passar pela IA - usado pelo seletor de jogo 🗂️ (ver "Selecionar jogo pra analisar" abaixo) |

No ambiente de testes (chave `test_...`), os campeonatos disponíveis são: Brasileirão (`id 10`), Copa do Brasil (`id 2`) e Libertadores (`id 7`). Copa do Brasil e Libertadores são mata-mata, então `/rodadas` retorna vazio pra elas (não têm rodadas sequenciais).

**Observação sobre o ambiente de testes:** o endpoint `/partidas/:id` ignora o ID passado e sempre devolve o mesmo jogo fictício (Atlético-MG x Palmeiras), então clicar em jogos diferentes na tela sempre abre o mesmo resumo. Isso é uma limitação da chave `test_`, não um bug do projeto — com a chave `live_` cada ID retorna os dados reais daquela partida.

## Resiliência quando a cota da API acaba

Três coisas trabalham juntas pra evitar que a tela quebre quando a cota diária (100/dia no plano atual) estoura:

- **Cache "stale" como reserva** (`comCache` em [src/db/cache.js](src/db/cache.js)): se uma chamada real falha mas existe uma cópia antiga (vencida) salva, ela é usada em vez de propagar o erro. Um dado de horas atrás é melhor que nenhum dado. Só propaga erro quando aquela chave **nunca** foi buscada com sucesso.
- **Contador de uso** (`usoApiHoje()`): conta as chamadas que de fato saíram pra rede (HIT de cache não conta), reiniciando a cada dia. Conta tanto sucesso quanto erro *com resposta HTTP* da API Futebol (ex: 429 "limite diário atingido") - um erro desses significa que a chamada chegou lá e foi cobrada do lado deles, então não contar teria o contador ficando cada vez mais desincronizado do real assim que a cota estourasse (toda tentativa seguinte falha, mas continuaria "grátis" pro nosso contador). Só erro de rede puro (sem resposta nenhuma - timeout, DNS) não conta, porque nesse caso a chamada nunca chegou no servidor deles. Aparece como badge no topo (`GET /api/status`) e fica amarelo a partir de 50% de uso, vermelho a partir de 90% - o front-end busca esse número de novo depois de toda chamada à API (`fetchJSON` no [script.js](public/script.js)), então o badge atualiza sozinho conforme você usa o app, sem precisar recarregar a página. A API Futebol não expõe o uso real via header, então é uma contagem própria — o placar zera quando o servidor conta do zero, não necessariamente sincronizado com o reset real da API (que também não é documentado), e só reflete chamadas feitas *através deste app* - testar a chave direto (painel da API Futebol, Postman etc.) não aparece aqui.
- **Toast em vez de tela travada**: quando uma chamada falha por cota esgotada e não tem nem cache velho pra usar, aparece um aviso pequeno no canto (`mostrarToast`) em vez de qualquer coisa tomando a tela inteira. O texto não cita horário de reset porque a API não informa isso em lugar nenhum.
- **`Promise.all` sem tratamento de erro derruba tudo, não só o que falhou**: era um bug real, não coberto pelas três correções acima. `abrirFormaPreJogo` (comparativo pré-jogo) não tinha `try/catch` nenhum - se um time nunca cacheado falhasse, o modal ficava preso só com o cabeçalho, sem nenhuma mensagem. E `calcularProvaveis` usava `Promise.all` simples: **um** jogo sem cache derrubava o ranking inteiro, mesmo que os outros 9 tivessem dado certo. Corrigido: `abrirFormaPreJogo` agora tem `try/catch` com mensagem inline, e `calcularProvaveis` usa `Promise.allSettled` - joga fora só os jogos que falharam e mostra os que deram certo, com uma nota tipo "1 jogo não pôde ser calculado agora e ficou de fora".
- **`buscarFormaTime` tinha o mesmo problema, um nível mais fundo**: buscar o histórico de UM time já busca o detalhe de N jogos em paralelo (`getPartida` por partida) - com `Promise.all`, se a cota acabasse no meio dessas N chamadas, o time inteiro ficava sem forma nenhuma, mesmo tendo conseguido 9 de 10. Isso derrubava a análise inteira de uma seleção múltipla mesmo quando várias partidas individuais já tinham sido buscadas com sucesso. Corrigido pra `Promise.allSettled` em [formaService.js](src/services/formaService.js): aproveita os jogos que conseguiu, calcula a estimativa com o que tem (marcando `incompleto: true` na resposta quando sobrou menos jogo que o pedido), e guarda esse resultado parcial com um TTL bem mais curto (2 min em vez de 30) - pra próxima vez que alguém pedir a forma desse time, tentar de novo completar o que faltou. Como cada `getPartida` individual já fica cacheado por conta própria (1 ano, jogo encerrado não muda mais) assim que busca com sucesso, "continuar de onde parou" já acontece sozinho: uma nova tentativa só gasta cota com os jogos que realmente ainda faltam, não refaz o que já deu certo. O seletor 🗂️ mostra um aviso amarelo no card quando isso acontece.
- **A varredura de rodadas do seletor 🗂️ também podia travar tudo por uma rodada só**: `abrirSelecionarJogos` (no [script.js](public/script.js)) junta os jogos agendados de até 3 rodadas seguidas: se uma dessas rodadas nunca tivesse sido buscada antes (sem cache pra cair como reserva) e a cota estivesse zerada, a tela toda de seleção falhava, mesmo que rodadas seguintes estivessem com cache disponível. Corrigido: uma rodada que falhar não trava a varredura - tenta a rodada seguinte (só não dá pra saber com certeza qual é `proxima_rodada` de uma leitura que falhou, então assume número + 1).

### Navegação por dias (aba Jogos)

No lugar de setas + "36ª Rodada", os jogos aparecem agrupados por data com uma barra horizontal de
pílulas no estilo apps de apostas (Sportingbet, Superbet etc.): cada pílula mostra um rótulo relativo
("Hoje", "Amanhã", "Em 2 dias", "Ontem", "3 dias atrás"...) e a data curta embaixo (`formatarRotuloPill`/
`formatarDataCurta` no [script.js](public/script.js)). Clicar numa pílula rola suavemente até o grupo
daquele dia na lista e marca ela como ativa. As setas `‹`/`›` continuam trocando de rodada inteira (a
API só entrega jogos rodada por rodada) — a rodada atual agora aparece como legenda pequena
("26ª RODADA") acima da lista, em vez de ser o elemento principal de navegação.

## Comparativo pré-jogo (aba Jogos)

Ao clicar num jogo com status `agendado`, a página abre um comparativo lado a lado dos últimos N jogos (5/10/15, escolhido no seletor "Últimos N jogos" do topo) dos dois times:

- Tag de posição/pontos/zona na tabela + até 2 rótulos curtos de estilo de jogo (ex: "Contra-ataque", "Ataque volumoso"), derivados das médias com limiares fixos documentados em `sinaisPerfil()` no [script.js](public/script.js)
- Últimos resultados (bolinha verde = vitória, cinza = empate, vermelha = derrota)
- **Abas por time** (`secaoDetalheTimes`): escolhe um dos dois times e mostra o perfil individual dele — médias do período, Top 5 atuações e as "Chances" (ver abaixo) — sem sair do modal. Clique no outro time pra trocar.
- **Estimativa estatística**: probabilidade de vitória/empate/derrota calculada com um modelo de Poisson simplificado (gols esperados = média de gols pró de um time combinada com a média de gols sofridos do outro). A mesma grade de Poisson também gera **"Ambas marcam"** e **"Mais de 2.5 gols"** (soma as combinações de placar onde os dois marcam, ou onde o total passa de 2.5).
- **Palpites fortes**: em vez de sempre mostrar os mesmos mercados fixos (tipo "ambas marcam: 35%",
  um número baixo e pouco útil), `palpitesFortes()` no [script.js](public/script.js) junta os seis
  candidatos possíveis - vitória de cada time, empate, ambas marcam / não ambas marcam, mais / menos
  de 2.5 gols - e mostra só os que passam de 60% de confiança, do maior pro menor. Um jogo equilibrado
  (nenhum mercado forte de nenhum lado) mostra uma nota em vez de forçar um palpite fraco.

Esse comparativo (clique direto num jogo) usa o histórico **geral** de cada time (`/api/times/:id/forma`,
casa e fora misturados) - é a visão rápida de "olhei e já vi". A análise **separada por mando de campo
e com contexto de tabela** (ver "Contexto e mando de campo" mais abaixo) é a versão mais rigorosa, feita
pelo seletor 🗂️ ou pelo Chat.

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

## Prováveis (aba Prováveis)

Ranking dos jogos agendados da rodada atual ordenados pela maior probabilidade calculada (mesmo modelo de Poisson do comparativo pré-jogo). Um seletor deixa escolher o limiar (55/60/65/70%) — só entram no ranking os jogos em que vitória de um dos lados ou empate bate esse percentual; mostra até os 10 primeiros, ordenados do maior pro menor.

Diferente das outras abas, essa **não carrega sozinha** ao trocar de aba — tem um botão "Calcular jogos prováveis desta rodada" (`calcularProvaveis()` em [script.js](public/script.js)), porque calcular pra todos os jogos da rodada de uma vez busca a forma dos dois times de cada confronto (bem mais requisições do que abrir um jogo por vez). Clicar num item do ranking abre o comparativo completo daquele jogo, reaproveitando `abrirFormaPreJogo`.

Testado com dados reais simulando as respostas da API (`window.fetch` sobrescrito temporariamente) - confirmei o cálculo (ex: Novorizontino 45% vs Avaí, Juventude 38% vs Atlético-GO), a ordenação, a numeração do ranking e o clique abrindo o comparativo certo.

## Chat (aba Chat)

Assistente em linguagem natural: você escreve algo como *"manda pra mim palpites do jogo Náutico x
Botafogo-SP"* e ele devolve uma análise no estilo ficha de casa de apostas (vitória/empate/derrota +
chances de escanteios, cartões, gols etc).

### Configuração (engrenagem ⚙️ na aba Chat)

Clicando na engrenagem, dá pra escolher o **provedor de IA** (Claude/Anthropic, ChatGPT/OpenAI ou
Gemini/Google), colar a **chave de API** da sua conta nesse provedor, opcionalmente trocar o **modelo**
(cada provedor já vem com um padrão sensato) e escolher quantos **jogos recentes por time** (5/10/15) a
análise deve usar. Tudo isso fica salvo só no `localStorage` do seu navegador e é enviado direto pro seu
próprio backend a cada pergunta - nunca passa por nenhum servidor além do seu. Sem chave configurada
aqui, o servidor tenta usar a variável de ambiente correspondente do `.env` como fallback.

A quantidade de jogos (5/10/15) é decidida uma vez nas configurações, não perguntada em cada mensagem -
a IA já recebe instrução de usar esse padrão automaticamente sem interromper a conversa pra perguntar,
a menos que você mesmo peça um número diferente no meio do papo.

### Como funciona (mesmo cálculo, três provedores)

Não importa o provedor escolhido, o modelo **não inventa nenhum número**: ele usa "tool use" (function
calling) pra chamar duas ferramentas que rodam no seu próprio backend e devolvem dados reais antes de
responder - a lógica das ferramentas é compartilhada entre os três provedores, só o formato da chamada
muda (`src/services/chatTools.js`):

- `buscar_jogos_rodada` - lista os jogos de uma rodada (times, IDs, placar) pra achar o confronto que
  o usuário descreveu, mesmo com nome parcial/apelido.
- `analisar_confronto` - busca o histórico real dos dois times (`buscarFormaTime`, o mesmo usado no
  comparativo pré-jogo) e calcula a mesma estimativa de Poisson e as mesmas "Chances" (over/under) das
  outras abas, em `src/services/estatisticasService.js` - reimplementação em Node do que já existe em
  `estimarProbabilidades`/`calcularAlertas` no [script.js](public/script.js), pro cálculo ficar
  determinístico (feito por código) em vez de o modelo "chutar" a conta.

Cada provedor tem seu próprio arquivo de integração, todos reaproveitando as mesmas ferramentas:

| Provedor | Arquivo | SDK | API usada |
|---|---|---|---|
| Claude (Anthropic) | `src/services/anthropicChat.js` | `@anthropic-ai/sdk` | Messages API (tool use) |
| ChatGPT (OpenAI) | `src/services/openaiChat.js` | `openai` | Responses API (function calling) |
| Gemini (Google) | `src/services/geminiChat.js` | `@google/genai` | Interactions API (function calling) |

`src/services/chatService.js` só escolhe qual dos três chamar, com base no `provedor` enviado pelo
front-end. O histórico da conversa fica só na memória do navegador (`chatHistorico` no
[script.js](public/script.js)) e é reenviado a cada pergunta - a API é stateless, não guarda sessão no
servidor. Como cada provedor guarda o histórico num formato bem diferente (blocos do Claude, itens da
Responses API, "steps" do Gemini), trocar de provedor no meio da conversa reseta o histórico
automaticamente em vez de mandar um formato incompatível pro provedor novo. Cada busca de histórico de
time passa pelo mesmo cache SQLite das outras abas, então perguntar pelo mesmo confronto de novo não
gasta cota da API Futebol de novo.

**Custo:** cobrança por token na sua própria conta do provedor escolhido, não tem plano incluso. Pra um
uso pessoal esporádico (algumas perguntas por dia, entre você e seu irmão) o custo tende a ficar na casa
de centavos por mês, mas depende do modelo - ver a página de preços do provedor escolhido.

### Selecionar jogos pra analisar - com múltipla (🗂️)

O botão 🗂️ - na aba Jogos (perto das setas de rodada) e na aba Chat (perto da engrenagem) - abre um
jeito rápido de escolher um ou vários jogos futuros pra analisar, sem digitar nada.

Fluxo: escolhe o **dia** (pílulas "Amanhã / Em 2 dias / Em 3 dias..."; o app junta os agendados de até
3 rodadas seguidas pra ter bastante dia pra navegar, preenchendo bem o espaço da tela) → vê **todos os
jogos daquele dia** como uma lista com checkbox (times, escudo, horário) → marca um ou mais jogos - a
seleção continua marcada ao trocar de dia, então dá pra montar uma "múltipla" com jogos de dias
diferentes → "Analisar seleção" calcula cada jogo separadamente (`Promise.allSettled` - um jogo sem
histórico suficiente não derruba os outros), usando a quantidade padrão configurada (engrenagem do
chat, ou o seletor "Últimos N jogos" do topo quando a seleção parte da aba Jogos). **Só entram jogos
com o histórico 100% completo** - se a cota da API acabar no meio da busca de algum jogo (incompleto -
ver seção de resiliência acima), esse jogo fica de fora da seleção em vez de aparecer com dado parcial;
o toast avisa quantos ficaram de fora e por quê.

### Contexto e mando de campo

`analisar_confronto`/`analise-automatica` (usado pelo 🗂️ e pelo Chat, não pelo comparativo pré-jogo por
clique direto) busca o histórico de cada time já separado por mando de campo - o mandante usa só os
jogos que fez **em casa**, o visitante só os que fez **fora**, já que o desempenho costuma ser bem
diferente dependendo de onde joga. Se não houver jogos suficientes nesse recorte específico (início de
temporada, time recém-promovido), cai pro histórico geral (casa + fora misturado) e avisa isso no card/
resposta (`mandoEspecifico: false`). Times com menos de 4 jogos analisados também ganham um aviso de
amostra pequena (`amostraPequena: true`).

Cada time também vem com o **contexto de tabela** (posição, pontos, e se está brigando por acesso à
Série A, playoff de acesso, ou fugindo do rebaixamento) - dado que já existe na classificação, sem
gastar requisição extra (`contextoTime()` em [chatTools.js](src/services/chatTools.js)).

**O que a API não tem, e por isso o app nunca inventa:** desfalques confirmados (lesão/suspensão),
clássico/rivalidade regional, e situação do técnico/pressão de torcida. Esses três fariam parte de uma
análise completa, mas a API Futebol não expõe esse tipo de dado - o prompt do chat é explícito em
declarar essa limitação numa linha em vez de arriscar um palpite baseado em achismo.

**Importante:** cada jogo é analisado de forma independente - o app nunca calcula nem mostra uma
"probabilidade combinada" da múltipla inteira (isso exigiria assumir que os jogos são estatisticamente
independentes, o que não é garantido, e criaria uma falsa sensação de precisão). O prompt do chat
também é explícito nisso: ao receber vários jogos pré-calculados, monta uma ficha curta pra cada um,
sem inventar um número combinado.

O que acontece com o resultado depende de onde a seleção começou:

- **Pela aba Chat**: vira uma mensagem no chat pedindo pra IA só formatar a ficha de cada jogo
  (vitória/empate/derrota, ambas marcam, mais de 2.5 gols, chances) - o prompt deixa explícito que,
  nesse caso, ela não deve chamar as ferramentas de novo, só usar os números já calculados.
- **Pela aba Jogos**: não passa por nenhuma IA - o resultado é salvo direto na aba **Jogos Pesquisados**
  (ver abaixo), como uma "múltipla" quando mais de um jogo foi selecionado.

## Jogos Pesquisados

Toda análise feita pelo seletor 🗂️ da aba Jogos vira um card guardado nessa aba, sem precisar de IA
nem de chave de nenhum provedor - é só o cálculo determinístico (Poisson + Chances) de sempre, guardado
no `localStorage` do navegador (até 30 mais recentes). Selecionar vários jogos de uma vez guarda todos
juntos num único card "Múltipla de N jogos". Cada jogo dentro do card mostra:

- A barra de probabilidade (mesmo componente visual do comparativo pré-jogo) + os "Palpites fortes"
  daquele jogo específico (só os mercados com 60%+ de confiança - ver seção acima)
- Uma "Sugestão" com o lado de maior probabilidade (vitória de um dos times, ou empate) e o percentual
- As 9 "Chances" (over/under) de cada time, sem cortar pras mais altas - pra dar visão completa de
  todos os mercados na hora de montar uma múltipla (ex: escanteios de um time específico)
- Quando o jogo acontece e quando você pesquisou, com botão pra remover o card inteiro
- Um aviso amarelo quando a cota acabou no meio da busca do histórico de algum time (ex: "baseado em
  6 de 10 jogos") - a estimativa já vem calculada com o que deu pra buscar; analisar esse confronto de
  novo mais tarde completa sozinho o que faltou, sem gastar cota de novo com o que já foi buscado

`localStorage` só guarda o texto de quem pesquisou naquele navegador especificamente - não sincroniza
entre aparelhos nem precisa de conta.

### Acertômetro

Botão "✅ Conferir resultados" no topo da aba: pra cada jogo salvo que ainda não foi conferido, busca o
resultado real (`GET /api/matches/:id/resultado`, um wrapper enxuto de `getPartida`) e compara com a
Sugestão que ficou salva. Se o jogo ainda não terminou, fica pra conferir depois - não trava nem gasta
cota à toa (o detalhe da partida cacheia por 1 ano assim que o jogo termina, então conferir de novo é
grátis). Um resumo tipo "Acertômetro: 7 de 10 sugestões bateram (70%)" aparece no topo da aba assim que
existe pelo menos um jogo conferido, e cada card mostra "✅ Acertou" ou "❌ Errou" com o placar real ao
lado da Sugestão. Jogos salvos antes dessa função existir não têm o ID da partida guardado, então ficam
de fora da conferência (não têm como saber qual jogo real conferir).

### Compartilhar como imagem

O ícone 📤 no cabeçalho de cada card gera uma imagem PNG do card (via [html2canvas](https://html2canvas.hertzen.com/),
carregado por CDN) e abre o menu de compartilhamento nativo do celular (`navigator.share`) - inclui
WhatsApp direto se o app estiver instalado como PWA num Android/iPhone. No desktop, ou se o navegador
não suportar compartilhamento de arquivo, baixa a imagem em vez de abrir o menu.

### Aviso "faltam 30 min"

Botão "🔔 Avisar 30 min antes": pede permissão de notificação do navegador e, enquanto o app estiver
aberto (aba ou PWA rodando), checa a cada minuto se algum jogo salvo em Jogos Pesquisados está a 30
minutos ou menos de começar, disparando uma notificação local nesse caso. **Importante:** isso não
é notificação push de verdade - com o app fechado, não chega aviso nenhum. Notificação push de
verdade exigiria um *service worker* + servidor de push (VAPID) + algo mantendo o Render acordado no
horário certo (o plano free dorme sozinho) - complexidade e infraestrutura que não valem a pena pro
tamanho desse app hoje. O aviso atual é o equivalente prático: funciona bem se você deixa a aba aberta
ou o PWA rodando em segundo plano no celular.

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
  config/limites.js                limite diário de requisições da API Futebol
  db/cache.js                      cache local em SQLite (padrão cache-aside)
  services/apiFutebolService.js    chamadas HTTP à API Futebol (passam pelo cache)
  services/formaService.js         forma recente de um time - por quantidade ou por seleção manual de jogos
  services/estatisticasService.js  modelo de Poisson + Chances (mesma lógica do front-end, em Node)
  services/chatTools.js            ferramentas e prompt do chat, compartilhados pelos 3 provedores
  services/anthropicChat.js        integração Claude (Anthropic) do chat
  services/openaiChat.js           integração ChatGPT (OpenAI) do chat
  services/geminiChat.js           integração Gemini (Google) do chat
  services/chatService.js          escolhe o provedor de IA e delega pra ele
  controllers/matches.controller.js      lógica das rotas de partidas
  controllers/campeonatos.controller.js  lógica das rotas de campeonatos
  controllers/times.controller.js        lógica da rota de forma recente
  controllers/chat.controller.js         lógica da rota de chat
  routes/matches.routes.js         definição das rotas de partidas
  routes/campeonatos.routes.js     definição das rotas de campeonatos
  routes/times.routes.js           definição da rota de forma recente
  routes/chat.routes.js            definição da rota de chat
  app.js                           configuração do Express
  server.js                        ponto de entrada (sobe o servidor)
```
