# Antigravity como modelo principal do DSH

Instale o plugin e converse. A versão **0.3** usa o servidor ACP oficial do Google
como provider principal e conecta automaticamente as **ferramentas do DSH** por
uma ponte MCP privada. Sem API key, configuração manual de MCP ou APIs privadas
de modelos do Antigravity.

## Instalação

Use Node.js >=22.19 e DSH 0.2.1-alpha.1:

```powershell
dsh plugin --profile web add git+https://github.com/dannndouglas/dsh-antigravity-acp.git
```

Abra o perfil e envie uma mensagem. Se ele já estiver aberto, use seu
recarregamento normal. Não precisa baixar binários, definir variáveis, editar
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

O DSH mantém o histórico oficial. Novos turnos partem desse contexto completo;
somente uma troca de ferramenta ainda pendente mantém estado ACP. Conversas
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

Texto e reasoning são suportados. Imagens/áudio binários, controles temperature,
maxTokens, stop e reasoningEffort explícito não estão implementados. Escolha um
modelo anunciado para seu tier de reasoning. Tokens de faturamento não são
inventados a partir de ocupação de contexto. Reinícios retomam o histórico salvo
no DSH, sem persistir uma sessão ACP própria.

O [registro de testes reais](agy-acp-probe.md) documenta conversa, ferramentas,
criação/leitura de arquivo no DSH instalado, cancelamento e reconexão.
Veja [arquitetura](architecture.md) e [README completo](../README.md) para limites,
opções, diagnóstico e detalhes da ponte. Plugin comunitário independente de
Google e DeepSeek; código MIT.
