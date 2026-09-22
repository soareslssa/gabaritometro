# Gabaritômetro

Extensão do Chrome que conta suas questões no **TEC Concursos**: quantas você fez, quantas
acertou, quantas errou, a porcentagem, e — o que mais importa — **em quais matérias você é fraco**.

Tudo fica em `chrome.storage.local`. Nada sai da sua máquina, nenhum servidor, nenhuma
credencial do TEC é lida ou tocada.

## Como funciona

A extensão observa a página do TEC para saber quando você respondeu uma questão e qual foi o
resultado, e registra isso localmente. Ela **apenas lê**: não altera requisições, respostas nem o
estado da página, não mexe na sua conta e não toca em credenciais.

A leitura não depende de classes CSS — elas quebram a cada redesign do site. Os detalhes de
implementação ficam em [`src/main/tec-hook.js`](src/main/tec-hook.js), comentado.

Se o site mudar de tecnologia e a captura automática parar de funcionar, o painel cai sozinho em
**modo manual**: botões `Acertei` / `Errei` / `Anul.`, que funcionam em qualquer situação — inclusive
fora do TEC.

## Instalar

1. `chrome://extensions` → ligar **Modo do desenvolvedor**
2. **Carregar sem compactação** → selecionar esta pasta
3. Abrir um caderno no TEC — o painel aparece no canto inferior direito

## O que você vê

**Painel na página**: feitas / certas / erradas / % de hoje, barra da meta diária, cronômetro da
questão atual (fica amarelo se você passar do limite), botões manuais e desfazer.

**Popup do ícone**: meta do dia, comparativo com a semana anterior, ofensiva (🔥), gráfico dos
últimos 30 dias (verde = acertos, vermelho = erros), acumulado geral com tempo médio, e a lista
**"Onde você erra mais"** — matérias ordenadas da pior para a melhor taxa de acerto, filtrando
amostras pequenas para não ranquear uma matéria com 3 questões.

**Badge do ícone**: número de questões feitas hoje (fica verde quando bate a meta).

## Chutei

Botão `🎲 Chutei` no painel. Pode clicar **antes** de responder (arma a marcação) ou **depois**
(aplica retroativamente no registro que acabou de entrar) — você não precisa lembrar na hora certa.

Isso cria a métrica **% domínio** no popup: a taxa de acerto descontando os acertos que foram
sorte. Acertar 8 de 10 com 3 chutes certos não é 80% de domínio, é 50%. A diferença entre as duas
porcentagens é o tamanho da sua zona de risco.

## Modo simulado

Botão `Simulado` no painel inicia um bloco de N questões (configurável, padrão 20) com o
**gabarito escondido**: você responde tudo e só vê o resultado no fim, consolidado.

O destaque colorido da alternativa correta **não é sobrescrevível por CSS** nessa página — nem com
`!important`, nem com estilo inline. Medido, não suposto; o registro do que foi testado está em
[`src/content/simulado.js`](src/content/simulado.js).

Por isso o simulado não tenta apagar a cor: depois que a questão é respondida, ele esconde a **lista
de alternativas inteira**, com CSS, sem tocar no DOM da página. Esconder a lista toda, e não só a
alternativa marcada, é proposital — apagar apenas a certa entregaria a resposta pela ausência.

## Contar questões fora do TEC (PDF, prova impressa)

Popup → **Contar em PDF** abre uma janela pequena e independente, que fica ao lado do PDF e
**não fecha quando você clica fora**. Você informa matéria, assunto e banca, e registra com
`Acertei` / `Errei` / `Anulada`, com `🎲 Chutei` e `↶ Desfazer`.

Por que uma janela destacada e não o popup do ícone: o popup da barra de ferramentas fecha ao
primeiro clique fora dele — cada clique no PDF mataria o contador.

Por que não um painel injetado em qualquer site: isso exigiria permissão de leitura em **todos** os
sites que você visita, para resolver um problema que uma janelinha resolve. Sendo uma página da
própria extensão, ela acessa o storage sem nenhuma `host_permission` nova. Efeito colateral bom:
funciona também para PDF em leitor externo, prova impressa ou tablet.

Os registros caem nas **mesmas** estatísticas do TEC — total, %, ranking por matéria — e cada um
guarda a origem, então o popup mostra o split `TEC 120 · PDF 34`.

## Listas e reset

**Finalizar lista** fecha o agrupamento atual e mostra o resultado dele (total, %, tempo médio).
Não apaga nada: é só o fim do agrupamento. Depois, "Nova lista" já vem com a matéria anterior
preenchida — repetir é um clique, trocar de matéria é editar um campo. No painel do TEC o botão só
aparece quando existe lista aberta.

**Zerar hoje** (popup) apaga as questões e as horas do dia, preservando os dias anteriores. O
diálogo diz exatamente o que vai sumir ("34 questões e 2h10 de hoje") — "zerar" sem número é um
convite a erro.

Detalhe que importa: `resetDay` subtrai dos agregados em vez de reconstruí-los a partir dos
registros individuais. Registros são podados em `MAX_ATTEMPTS`, então reconstruir apagaria
agregados antigos legítimos de quem já tem histórico longo. Tem teste específico para isso.

## Horas líquidas

Cronômetro de blocos no painel, com presets configuráveis (padrão 45 / 56 / 75 min). Ele **para
sozinho** quando você não está estudando e retoma quando volta:

| situação | comportamento |
|---|---|
| troca de aba, minimiza, bloqueia a tela | pausa; retoma ao voltar |
| 5 min sem mouse/teclado/scroll | pausa; retoma no primeiro movimento |
| navega para outra questão (reload do TEC) | acumulado preservado, continua |
| Chrome fechado à força / máquina desligada | credita só até o último batimento |
| você pausa no botão | **não** retoma sozinho ao voltar — pausa sua é intencional |

Não pausa quando a janela perde o foco mas continua visível: estudar com um PDF ao lado é uso
normal, e pausar aí tornaria o número inútil.

### Por que o tempo não pode ser inventado

O jeito ingênuo — guardar `startedAt` e fazer `agora - startedAt` — quebra feio: se o Chrome morrer
com o cronômetro rodando, ao reabrir você "estudou" 8 horas durante a noite.

Enquanto roda, o estado grava `heartbeatAt` a cada 5s, e o crédito é limitado por ele:

```
creditado = min(agora, heartbeatAt + tolerância) - startedAt
```

O pior caso é perder 5 segundos reais; nunca ganhar horas fantasmas. O acumulado também é limitado
ao alvo do bloco — um bloco de 45 min jamais credita 46, mesmo que a máquina hiberne no meio.

**Múltiplas abas**: cada aba tem um token e só a dona acumula, senão duas janelas do TEC abertas
contariam o mesmo tempo duas vezes.

O bloco é creditado à matéria **dominante** (a com mais questões respondidas nele), não rateado
questão a questão. Para quem estuda um assunto por bloco, é o comportamento certo; se você misturar
duas matérias no mesmo bloco, tudo vai para a que teve mais questões.

## Regras de contagem

- **Mesma questão, mesmo dia**: conta uma vez só. Configurável para "vale a primeira" (padrão)
  ou "vale a última resposta".
- **Mesma questão, dia diferente**: conta de novo — isso é revisão, e revisão é o ponto.
- **Anuladas**: entram no total, mas ficam fora do cálculo de porcentagem.
- **Ofensiva**: derivada do conjunto de dias com atividade, não incremental — então importar
  dados antigos ou registrar fora de ordem não corrompe o streak.

## Configurações

Meta diária, limite de "questão lenta", amostra mínima por matéria, modo de contagem, ligar/
desligar o painel, e **exportar / importar / apagar** os dados (JSON).

## Testes

```
node scripts/test-logic.mjs
node scripts/test-timer.mjs
node scripts/test-list.mjs
```

`test-list.mjs` — 26 asserções sobre listas, origem e reset: ciclo da lista, herança de
matéria/assunto/banca, ids únicos, split TEC × PDF, `resetDay` preservando os dias anteriores e
recalculando a ofensiva, e a **regressão do chute retroativo** (o id era remontado por fora e
virava `tec:undefined`, fazendo `setGuess` falhar em silêncio).

`test-timer.mjs` — 25 asserções sobre o cronômetro, com o "agora" injetado (nenhum teste espera
tempo real passar): acumulação em trechos, o clamp do heartbeat contra crash, pausa manual que não
se desfaz sozinha, teto do bloco, matéria dominante com desempate determinístico e persistência das
horas por dia/matéria.

`test-logic.mjs` — 29 asserções cobrindo contagem, dedupe no mesmo dia, revisão em dia diferente, anulada fora da %,
ofensiva com registros fora de ordem, ranking por matéria, desfazer, import idempotente, tempo
médio, chute (incluindo marcação retroativa e desmarcação) e ciclo do simulado.

## Ideias para depois

- Caderno de erros com revisão espaçada (1/3/7/15/30 dias) — o schema já guarda a URL da questão
- Comparativo semanal por matéria, não só global
- Exportar CSV
