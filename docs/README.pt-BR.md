# Antigravity como modelo principal do DSH

Plugin independente para o DeepSeek Harness (DSH). Usa o servidor ACP oficial
do Google Antigravity como provedor de modelos e conecta automaticamente as
**ferramentas do DSH** por uma ponte MCP privada.

> [!WARNING]
> **O Google pode suspender ou banir sua conta.** Se você usar sua assinatura
> Google AI (incluindo Pro ou Ultra) para acessar o Antigravity por uma ferramenta
> de terceiros não autorizada, o Google pode suspender ou encerrar seu acesso ao
> Antigravity ou ao Gemini CLI. Em caso de violação relevante ou recorrente, os
> termos gerais do Google também preveem a exclusão da sua Conta do Google.
>
> A documentação pública do Google não confirma especificamente que esta
> integração com o DSH esteja autorizada para uso com a assinatura. Consulte os
> termos antes de instalar ou entrar na sua conta.
> [Termos do Antigravity](https://antigravity.google/terms) ·
> [Termos de Serviço do Google](https://policies.google.com/terms?hl=pt-BR)

## Instalação

Use Node.js >=22.19 e DSH **0.2.0-rc.2**, **0.2.1-alpha.1**, **0.2.1-rc.2**,
**0.2.1-rc.3**, **0.2.1-rc.5**, **0.2.2-rc.1**, **0.2.2-rc.2**, **0.2.2-rc.3**,
**0.2.2-rc.4** ou **0.2.2-rc.5**. A versão **0.3.7** adiciona o DSH 0.2.2-rc.4/rc.5
e é compilada com as bibliotecas do DSH 0.2.2-rc.5. A versão **0.3.6** mantém conversas longas dentro do
limite de requisição do Antigravity, permite que a compactação do DSH use este
provedor e mantém a rota `server-default` válida após a descoberta de modelos. O
plugin usa os serviços fornecidos pelo próprio DSH. Não é necessário aceitar
exceções de versão ou alterar configurações.

O nível de raciocínio é escolhido pelo ID exato do modelo, como o sufixo `-low`.
O seletor separado de esforço do DSH é aceito por compatibilidade e não altera
essa escolha de modelo.

Na tela de plugins do DSH, use a URL do repositório:

https://github.com/dannndouglas/dsh-antigravity-acp

Se preferir instalar pelo terminal:

```powershell
dsh plugin --profile web add git+https://github.com/dannndouglas/dsh-antigravity-acp.git
```

A versão **0.3.3** também aproveita os processos prontos nos pedidos sem
ferramentas. O primeiro desses pedidos pode usar a sessão ainda vazia criada pelo
seletor de modelos, evitando abrir outro processo e criar outra sessão. Até dois
processos ficam prontos por cinco minutos. Os turnos seguintes recebem sessões
ACP novas com o histórico atual do DSH; cada turno com ferramentas recebe sua
própria ponte MCP. Não há configuração adicional.

Na comparação local com Gemini 3.8 Flash Low, dois pedidos por versão levaram
18–21 segundos até o primeiro texto na 0.3.2 e 8,7–9,2 segundos na candidata
0.3.3, após a descoberta dos modelos e sem ferramentas. São poucas amostras,
não uma garantia de tempo. Inicialização a frio, criação de novas sessões,
seleção do modelo e geração no servidor Google ainda têm custo variável.
Veja as [medições e seus limites](performance.md).

Abra o perfil e envie uma mensagem. Após instalar ou atualizar no DSH Desktop,
encerre o DSH completamente e abra de novo. O aplicativo aberto pode manter o
módulo anterior em memória, mesmo que a instalação já mostre a versão nova.
Se não houver botão de atualizar, remova o plugin, instale novamente pela mesma
URL do repositório e encerre e reabra o DSH. Não precisa baixar binários, definir variáveis, editar
arquivos ou executar login pelo terminal. Antigravity é o padrão dos chats novos,
respeitando escolhas explícitas já salvas no perfil ou na sessão.

No primeiro uso, o plugin baixa a distribuição completa oficial do Google
conforme o [ACP Registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json).
Windows, macOS e Linux são suportados em x64 e arm64. O download fica em cache.

Se necessário, o servidor oficial abre o navegador ao enviar a primeira mensagem.
Autorize sua conta Google; a conversa continua automaticamente. Esse consentimento
é a única interação adicional quando a conta ainda não está autenticada. O plugin
não lê nem armazena credenciais. Os modelos aparecem no seletor normal do DSH.

## Ferramentas

O Antigravity pede uma ferramenta pela ponte MCP. O plugin emite uma chamada
normal do DSH, que aplica suas permissões, executa a ação e registra o resultado.
Depois, o resultado retoma a mesma conversa ACP sem reenviar o pedido do usuário.
Arquivos, comandos e ferramentas de extensões seguem esse caminho.

Há suporte a chamadas paralelas, múltiplas rodadas, erros e recusas. Uma ferramenta
negada continua negada. Eventos nativos ACP não são transformados em novas ações,
evitando execução duplicada. Pedidos de permissão para ferramentas fora da ponte
são recusados e a geração é encerrada; o modo YOLO não é ativado.

O DSH mantém o histórico oficial. Novos turnos partem desse contexto. O servidor
do Google corta silenciosamente, pelo final, uma requisição ACP acima de ~192 KB
(em um bloco, vários blocos ou recursos embutidos). Por isso o plugin cita primeiro
o pedido atual do usuário e mantém cada prompt abaixo de `maxPromptBytes`
(180.000 bytes): os schemas de ferramentas não são repetidos (a ponte MCP já os
fornece), as rodadas mais antigas são omitidas inteiras e só então os maiores textos
restantes são encurtados pelo meio. Cada modelo declara `contextWindow` (110.000
tokens) para que a compactação do DSH resuma o histórico antigo antes de atingir
esse limite. Somente uma troca de ferramenta ainda pendente mantém estado ACP. Conversas
simultâneas usam processos separados, incluindo chamadas feitas por subagentes.
Cancelamento funciona também enquanto a ferramenta está em execução ou aprovação.

## Opções e limites

O padrão é `toolPolicy: bridge`. Para uso avançado, um patch no perfil pode ajustar:

```yaml
- id: llm-antigravity-acp
  config:
    toolPolicy: bridge
    timeoutMs: 600000
    toolTimeoutMs: 900000
```

O prazo da geração pausa durante a ferramenta. O prazo de ferramentas inclui a
espera pela aprovação do DSH. Não é necessário definir essas opções para usar.
`text-only` permite optar por conversa sem ferramentas; `reject` recusa schemas.

O servidor oficial continua sendo um agente completo. A pasta temporária,
as permissões e a restrição de ferramentas são controles de protocolo, não um
sandbox do sistema operacional. Uma ação nativa pode ocorrer antes de ser
anunciada; o plugin não promete confinamento absoluto do executável do Google.

Texto e reasoning são suportados. Imagens/áudio binários não estão implementados.
O ACP não expõe temperature, maxTokens nem stop; quando pedidos internos do DSH
(compactação, títulos) os enviam, eles são ignorados (`ignoreUnsupportedOptions:
false` volta a recusá-los). Escolha um modelo anunciado para seu tier de reasoning.
`server-default` segue `defaultModel` ou o modelo atual do servidor; antes do
primeiro login aparece como **Sign in to Antigravity** e a primeira mensagem abre o
login oficial. Outras falhas de descoberta aparecem no seletor de modelos do DSH. Tokens de faturamento não são
inventados a partir de ocupação de contexto. Reinícios retomam o histórico salvo
no DSH, sem persistir uma sessão ACP própria.

O [registro de testes reais](agy-acp-probe.md) documenta conversa, ferramentas,
criação/leitura de arquivo no DSH instalado, cancelamento e reconexão.
Veja [arquitetura](architecture.md) e [README completo](../README.md) para limites,
opções, diagnóstico e detalhes da ponte. Plugin comunitário independente de
Google e DeepSeek; código MIT.
