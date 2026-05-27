# Validacao tecnica - 2026-05-27

Rodada executada em 2026-05-27 no projeto `c:\Users\Jamys\billing-app`.

## Resultado geral

- Status geral: aprovado com ressalvas.
- Codigo local: compila e passa no lint.
- Deploy publico: endpoints principais respondem.
- Ressalvas: `npm audit` ainda aponta vulnerabilidades em dependencias; WhatsApp real segue bloqueado por pendencias da Meta; teste autenticado/mobile real precisa ser repetido no navegador do celular apos deploy.

## Validacoes executadas

### Codigo local

- `npm run lint`: passou.
- `npm run build`: passou.
- Build Next.js gerou 52 paginas/rotas e validou TypeScript.
- `git status --short`: limpo antes da documentacao desta rodada.

### Workflows versionados do n8n

JSONs parseados com sucesso:

- `n8n/DAILY_APPOINTMENT_CONFIRMATION_REMINDERS.workflow.json`
- `n8n/WA_TENANT_APPOINTMENTS_INBOUND_v1.workflow.json`
- `n8n/WA_TENANT_BILLING_SIGNUP_INBOUND_v1.workflow.json`

### Variaveis locais

`.env.local` contem as seguintes chaves, sem expor valores no relatorio:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `N8N_BASE_URL`
- `N8N_API_KEY`

Observacao: as variaveis reais da WhatsApp Cloud API nao apareceram no `.env.local` desta maquina durante a checagem. Elas podem estar somente na Vercel/n8n.

### Supabase CLI

- `npx supabase --version`: timeout.
- `.\node_modules\@supabase\cli-windows-x64\bin\supabase.exe --version`: timeout.

Conclusao: o pacote esta instalado no projeto, mas a CLI local ficou travada nesta rodada. Para operacoes de banco ainda e mais seguro usar SQL Editor do Supabase ou investigar a CLI antes de depender dela.

### Deploy publico e dominios

- `GET https://app.meuassistentevirtual.com.br/api/health`: 200 OK.
- `HEAD https://app.meuassistentevirtual.com.br/privacidade`: 200 OK.
- `HEAD https://app.meuassistentevirtual.com.br/termos`: 200 OK.
- `HEAD https://www.meuassistentevirtual.com.br`: 200 OK.
- `HEAD https://meuassistentevirtual.com.br`: 307 para `https://www.meuassistentevirtual.com.br/`.
- `GET -L https://meuassistentevirtual.com.br/`: entregou HTML da home institucional com `Assistente Jack`, imagem `jack-hero.svg` e meta tag de verificacao do Facebook.
- `HEAD https://app.meuassistentevirtual.com.br/`: 307 para `/login`.
- `HEAD https://app.meuassistentevirtual.com.br/login`: 200 OK.

Conclusao: hoje o site institucional esta publicado em `www.meuassistentevirtual.com.br`/dominio raiz, enquanto `app.meuassistentevirtual.com.br` se comporta como painel e redireciona a raiz para login.

### Endpoints protegidos

- `HEAD https://app.meuassistentevirtual.com.br/api/tenant-whatsapp/link` sem token: 401 Unauthorized.
- `GET https://app.meuassistentevirtual.com.br/api/whatsapp/webhook` sem parametros validos: 403 Forbidden, com mensagem de token de verificacao invalido.
- `POST https://app.meuassistentevirtual.com.br/api/internal/whatsapp/send` sem token interno: 401 Unauthorized.

Conclusao: endpoints sensiveis nao ficaram abertos anonimamente nos testes sem credenciais.

### Auditoria de dependencias

`npm audit --audit-level=moderate`: falhou com 4 vulnerabilidades:

- `next`: high; correcao sugerida via `npm audit fix --force`, instalando `next@16.2.6` fora do range atual.
- `postcss`: moderate; dependente do ajuste de Next.
- `brace-expansion`: moderate; `npm audit fix` disponivel.
- `ws`: moderate; `npm audit fix` disponivel.

Recomendacao: tratar em uma tarefa separada, com update controlado e nova rodada de lint/build. Evitar `npm audit fix --force` sem revisar impacto.

## Mudancas recentes ja validadas

- Home publica renovada para o Assistente Jack.
- Tema claro aplicado no app.
- Configuracao de mensagens do WhatsApp movida para modal da inbox.
- Editor de mensagens com variaveis travadas, arrastaveis e insercao por toque no mobile.
- Confirmacao ao fechar a modal com alteracoes nao salvas.
- Inbound generico de cadastro por WhatsApp versionado em SQL/migration/workflow n8n.

## Pendencias humanas / externas

- Concluir validacao/revisao de negocio na Meta.
- Quando a Meta liberar, configurar/testar challenge do webhook com token real.
- Testar inbound real pelo link de tenant.
- Testar envio real pela inbox.
- Reexecutar no Supabase o SQL `supabase/tenant_whatsapp_entry_links.sql`, se ainda nao tiver sido reaplicado depois da correcao de `admin_ensure_tenant_whatsapp_entry_link`.
- Testar no celular real a insercao por toque das variaveis na modal de WhatsApp apos o deploy correspondente.
- Resolver ou aceitar conscientemente os achados de `npm audit`.

## Prompt para continuar em outra thread

```text
Bom dia, Codex. Estamos no projeto `c:\Users\Jamys\billing-app`.

Antes de mexer, leia `PROJECT_TRACKING.md` e `docs/validation-2026-05-27.md`.

Estado atual:
- Produto SaaS multi-tenant para cobrancas, clientes/alunos, agenda e restaurante.
- Vercel Pro em uso.
- Site institucional publicado em `https://www.meuassistentevirtual.com.br`; o dominio raiz redireciona para `www`.
- Painel/app publicado em `https://app.meuassistentevirtual.com.br`; a raiz do app redireciona para `/login`.
- `GET /api/health`, `/privacidade`, `/termos`, `/login` e a home institucional responderam 200 em 2026-05-27.
- `npm run lint` e `npm run build` passaram em 2026-05-27.
- JSONs versionados do n8n foram parseados com sucesso em 2026-05-27.
- `npm audit` ainda aponta vulnerabilidades em `next`, `postcss`, `brace-expansion` e `ws`; tratar com cuidado em tarefa separada.
- Supabase CLI local esta instalada via pacote do projeto, mas `npx supabase --version` e o binario direto deram timeout em 2026-05-27.
- WhatsApp Cloud API oficial ja tem adaptador, webhook e endpoint interno no app.
- Inbox WhatsApp tenant-side existe em `/whatsapp-inbox`.
- Configuracao de mensagens do WhatsApp fica em modal da inbox; variaveis funcionam por drag no desktop e por toque no mobile no codigo atual.
- Links de atendimento por tenant usam `tenant_whatsapp_entry_links`, API `GET /api/tenant-whatsapp/link`, codigo publico `jack-xxxxxxxx` e webhook resolve tenant pelo codigo na mensagem.
- Inbound generico de cadastro por WhatsApp para tenants com cobranca mensal foi versionado em SQL/migration/workflow n8n.
- Workflows n8n devem continuar genericos e orientados por dados; nao criar workflow por tenant.

Pendencias importantes:
1. Confirmar se `supabase/tenant_whatsapp_entry_links.sql` ja foi reexecutado no Supabase alvo depois da correcao da funcao `admin_ensure_tenant_whatsapp_entry_link`.
2. Aguardar/concluir validacao da Meta e configurar WhatsApp Cloud API seguindo `docs/meta-whatsapp-cloud-setup.md`.
3. Testar challenge real do webhook Meta.
4. Testar inbound real pelo link do tenant.
5. Testar envio real pela inbox.
6. Testar no celular real a insercao por toque das variaveis da configuracao de mensagens apos deploy.
7. Depois testar fluxo de agendamento em tenant `plan2`/`plan3`.
8. Tratar vulnerabilidades de dependencias com update controlado, lint/build e teste de rotas protegidas.

Ao fazer alteracoes, mantenha regras de tenant/plano validadas tambem em API/backend, nao apenas no front.
```
