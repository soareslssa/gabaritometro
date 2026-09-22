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

Cronômetro de blocos controlável em três lugares — **painel do TEC**, **janela do contador** e
**popup do ícone** — com presets (padrão 45 / 56 / 75 min, editáveis em Configurações) e um **campo
para digitar a duração na hora**: digite os minutos, Enter, e o bloco começa. O campo não guarda o
último valor, de propósito; e a duração é limitada a 10h, porque um alvo absurdo digitado por engano
viraria um bloco que nunca fecha.

Ele **para sozinho** quando você não está estudando e retoma quando volta:

| situação | comportamento |
|---|---|
| lendo PDF em outra aba, janela do contador aberta | **continua contando** |
| nenhuma janela da extensão visível | pausa; retoma quando uma voltar |
| minimiza ou fecha a janela do contador | pausa |
| 5 min sem mouse/teclado **no TEC** | pausa; retoma no primeiro movimento |
| navega para outra questão (reload do TEC) | acumulado preservado, continua |
| Chrome fechado à força / máquina desligada | credita só até o último batimento |
| você pausa no botão | **não** retoma sozinho — pausa sua é intencional |

O bloco é sustentado enquanto **qualquer** superfície da extensão estiver visível, não por aba.
Decidir por aba era o defeito original: ler um PDF em outra aba deixava a aba do TEC oculta e o
cronômetro morria exatamente quando devia contar.

### Estudando fora do TEC

A janela do contador é a **âncora** do bloco: enquanto ela estiver visível ao lado do PDF, o tempo
corre. Iniciar um bloco pelo popup abre essa janela junto — o popup fecha ao perder o foco, então
um bloco criado ali sem nenhuma superfície viva não acumularia nada.

**Limitação assumida:** na janela do contador não existe detecção de ociosidade. A ausência de
`mousemove` numa janela fora de foco não informa nada — manter a regra ali só produziria pausas
falsas no meio do estudo. Então, se você deixar a janela aberta e sair de perto, o tempo continua
contando. O dano é limitado ao alvo do bloco (`settle` não deixa estourar `blockMs`): num bloco de
45 min o máximo que se ganha é o que faltava para fechar os 45, nunca uma noite inteira. Resolver
isso de vez exigiria a permissão `idle` do Chrome, deliberadamente não adotada.

Tempo de leitura sem questões respondidas entra no total do dia **sem matéria** (aparece como "—").

### Por que o tempo não pode ser inventado

O jeito ingênuo — guardar `startedAt` e fazer `agora - startedAt` — quebra feio: se o Chrome morrer
com o cronômetro rodando, ao reabrir você "estudou" 8 horas durante a noite.

Enquanto roda, o estado grava `heartbeatAt` a cada 5s, e o crédito é limitado por ele:

```
creditado = min(agora, heartbeatAt + tolerância) - startedAt
```

O pior caso é perder 5 segundos reais; nunca ganhar horas fantasmas. O acumulado também é limitado
ao alvo do bloco — um bloco de 45 min jamais credita 46, mesmo que a máquina hiberne no meio.

**Múltiplas superfícies**: cada uma tem um token e só a dona do bloco acumula, senão duas janelas
contariam o mesmo tempo duas vezes. Se a dona sai de cena (aba fechada), a próxima superfície viva
assume o bloco — sem isso ninguém bateria o heartbeat e o clamp cortaria o tempo de quem está
estudando.

O fechamento do bloco (settle + crédito + gravação) é uma **única operação serializada** no storage,
porque três superfícies podem pausar o mesmo bloco; se duas lessem o pendente e gravassem em
paralelo, o mesmo tempo entraria em dobro.

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
node scripts/test-presence.mjs
```

`test-presence.mjs` — 26 asserções sobre presença entre superfícies e fechamento do bloco: aba do
TEC oculta com o contador visível continua sustentando, presença vencida não sustenta, `settleTimer`
é idempotente (pausar de duas superfícies não credita o tempo duas vezes), o clamp do batimento
sobrevive à troca de superfície, e os rótulos de estado compartilhados.

`test-list.mjs` — 26 asserções sobre listas, origem e reset: ciclo da lista, herança de
matéria/assunto/banca, ids únicos, split TEC × PDF, `resetDay` preservando os dias anteriores e
recalculando a ofensiva, e a **regressão do chute retroativo** (o id era remontado por fora e
virava `tec:undefined`, fazendo `setGuess` falhar em silêncio).

`test-timer.mjs` — 59 asserções sobre o cronômetro, com o "agora" injetado (nenhum teste espera
tempo real passar): acumulação em trechos, o clamp do heartbeat contra crash, pausa manual que não
se desfaz sozinha, teto do bloco, matéria dominante com desempate determinístico, persistência das
horas por dia/matéria, a normalização da duração digitada (vazio, texto, negativo, vírgula decimal,
valores absurdos) e um teste de fumaça do seletor de duração — que é o único caminho para iniciar
bloco nas três superfícies, e um erro nele quebraria todas de uma vez.

`test-logic.mjs` — 29 asserções cobrindo contagem, dedupe no mesmo dia, revisão em dia diferente, anulada fora da %,
ofensiva com registros fora de ordem, ranking por matéria, desfazer, import idempotente, tempo
médio, chute (incluindo marcação retroativa e desmarcação) e ciclo do simulado.

## Ideias para depois

- Caderno de erros com revisão espaçada (1/3/7/15/30 dias) — o schema já guarda a URL da questão
- Comparativo semanal por matéria, não só global
- Exportar CSV
