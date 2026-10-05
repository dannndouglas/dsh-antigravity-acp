# Antigravity ACP como provider principal do DSH

O plugin registra `antigravity-acp` no seletor normal de modelos do DSH e usa
o **servidor ACP oficial do Google** via stdio. O próprio servidor executa
`oauth-personal`. O plugin não lê tokens, não implementa OAuth e não usa API key.

**A versão 0.2 suporta conversa em texto e reasoning quando fornecido pelo
servidor. Não executa ferramentas do DSH.** ACP expõe um agente completo;
atividades de ferramentas nativas geram erro explícito e encerramento do processo.

## Instalação

Use Node.js >=22.19 e DSH 0.2.1-alpha.1. Adicione o plugin ao DSH:

```powershell
dsh plugin --profile web add git+https://github.com/dannndouglas/dsh-antigravity-acp.git
```

Abra o perfil e converse. Se o DSH já estiver aberto, use seu recarregamento
normal. **Não precisa baixar binários, definir variáveis, editar arquivos ou
executar login pelo terminal.** Antigravity é o padrão dos chats novos, exceto
quando já existe uma escolha explícita salva no perfil ou na sessão.

No primeiro uso, o plugin baixa a distribuição completa oficial do Google,
diretamente de `dl.google.com`, conforme o [ACP Registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json).
O download pode levar alguns minutos e é reutilizado nas próximas aberturas.
Há suporte automático para Windows, macOS e Linux, x64 e arm64.

Se a conta ainda não estiver autorizada, o servidor oficial abre o navegador
ao enviar a primeira mensagem. Autorize sua conta Google e a conversa continua
automaticamente. Essa autorização da conta exige sua interação; nenhuma
configuração técnica é necessária. O plugin não lê nem armazena credenciais.

O modelo padrão é o anunciado pelo servidor. Você pode trocar pelo seletor
normal do DSH; o catálogo é descoberto por ACP e os nomes não são fixos.

Configuração opcional no `cordis.patch.yml` **do perfil**:

```yaml
- id: llm-antigravity-acp
  config:
    command: 'C:\Tools\antigravity-acp\agy_acp_server.exe'
    auth: oauth-personal
    toolPolicy: text-only
```

Não duplique o `insert` da linha já fornecida pelo pacote. Para diagnóstico:
`node dist/cli.js doctor`; comandos também disponíveis: `login`, `status`,
`logout`, `probe`. `status` não abre login. O logout usa a operação do servidor
e pode afetar outros clientes que compartilhem essa conta.

## Limitações

O DSH controla o histórico: cada geração abre uma sessão ACP nova e envia o
contexto completo, inclusive respostas e resultados históricos de ferramentas.
Um processo oficial persiste entre chamadas; chamadas são serializadas.
Cancelamento envia `session/cancel`, encerra o processo com o serviço gerenciado
do DSH e permite reconexão no próximo turno.

Schemas de ferramentas atuais são omitidos de forma explícita com
`toolPolicy: text-only`. Use `reject` para recusar chamadas que contenham schemas.
MCP e ferramentas de programação precisam de outro provider nesta versão.
O plugin nega permissões e usa uma pasta temporária vazia; isso não constitui
um sandbox do sistema operacional para o agente oficial.

Sem suporte a controles `temperature`, `maxTokens`, `stop`, `reasoningEffort`,
imagens, áudio ou retomada persistente. Escolha IDs exatos do catálogo para tiers
de reasoning. `usage_update` informa ocupação de contexto, não faturamento;
contagens de tokens não são inventadas.

O [probe real](agy-acp-probe.md) registra o sucesso de autenticação,
streaming, multi-turn, cancelamento e reconexão pelo `ctx.llm` real.
O [README completo](../README.md) documenta configuração, erros e segurança.

Este é um plugin comunitário independente. O servidor e a conta continuam
sujeitos aos [termos do Google](https://antigravity.google/terms); a arquitetura
de transporte não determina permissões contratuais da conta.
