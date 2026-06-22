# Validacao tecnica - 2026-06-22

Rodada executada em 2026-06-22 no projeto `c:\Users\Jamys\billing-app`.

## Resultado geral

- Status geral: aprovado com ressalvas externas.
- Codigo local: compila, passa no lint e fica sem vulnerabilidades moderadas ou superiores apos `npm audit fix`.
- WhatsApp/Meta: envio pela plataforma ja foi validado com numero de teste, mas a permissao `whatsapp_business_messaging` segue em novo App Review.
- n8n: workflows remotos conferidos; somente cobranca diaria fica ativa.

## Validacoes executadas

### Codigo local

- `npm run lint`: passou.
- `npm run build`: passou.
- `npm audit --audit-level=moderate`: inicialmente apontou `@babel/core` e `js-yaml`; apos `npm audit fix`, passou com 0 vulnerabilidades.
- JSONs versionados em `n8n/*.workflow.json`: parseados com sucesso.

### Deploy publico

- `HEAD https://app.meuassistentevirtual.com.br/api/health`: 200 OK.
- `GET https://app.meuassistentevirtual.com.br/api/whatsapp/webhook` sem parametros validos: 403, como esperado.

### Vercel

Env vars confirmadas por nome em Production/Preview, sem leitura de valores:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_CLOUD_ACCESS_TOKEN`
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- `WHATSAPP_CLOUD_GRAPH_VERSION`
- `WHATSAPP_PUBLIC_PHONE_E164`
- `WHATSAPP_INTERNAL_SEND_TOKEN`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

Nao foram encontradas na Vercel:

- `WHATSAPP_INBOUND_N8N_WEBHOOK_URL`
- `WHATSAPP_INBOUND_N8N_TOKEN`

Observacao: isso nao bloqueia a inbox humana, porque o webhook grava inbound direto no Supabase. Essas envs serao necessarias quando quisermos encaminhar eventos normalizados para automacoes no n8n.

### n8n

Workflows remotos conferidos via API:

- `DAILY_BILLING_REMINDERS` (`YbD6NHWbgz9vLe33w_UU-`): ativo.
- `WA_TENANT_APPOINTMENTS_INBOUND_v1` (`X1lUop6Q5fh9uxTG`): inativo.
- `DAILY_APPOINTMENT_CONFIRMATION_REMINDERS` (`zWflZZXKn2XIlHEc`): inativo.
- `DAILY_TENANT_AGENDA_REMINDERS` (`dcKARQX6GDCBPo3W`): inativo.
- `WA_TENANT_BILLING_SIGNUP_INBOUND_v1` (`A4XOl16nkcIYOre1`): criado nesta rodada e mantido inativo.
- `WA_INBOUND_ROUTER_v1` (`JSlq95lyTAVjZjtz`): criado nesta rodada, ativado e testado pela rota `/webhook/wa-inbound-router-v1`.

Teste do roteador central:

- Payload fake com texto `Quero agendar um corte amanha`: 200, rota `appointments`, alvo `WA_TENANT_APPOINTMENTS_INBOUND_v1`.
- Payload fake com texto `Quero fazer cadastro de aluno na turma`: 200, rota `billing_signup`, alvo `WA_TENANT_BILLING_SIGNUP_INBOUND_v1`.

## Alteracoes aplicadas

- `package-lock.json` atualizado por `npm audit fix` sem `--force`.
- Documentacao do adaptador WhatsApp atualizada para refletir que o webhook ja grava mensagens na inbox e encaminha para n8n apenas quando as envs opcionais estiverem configuradas.

## Pendencias atuais

1. Aguardar aprovacao da Meta para `whatsapp_business_messaging`.
2. Apos aprovacao, testar inbound real pelo numero conectado e confirmar que a Meta entrega `POST /api/whatsapp/webhook` na Vercel.
3. Testar link de tenant com codigo `jack-xxxxxxxx` e conversa aparecendo na inbox.
4. Ativar workflows n8n WhatsApp apenas em go-live controlado.
5. Se automacoes inbound pelo n8n forem usadas, configurar `WHATSAPP_INBOUND_N8N_WEBHOOK_URL` e `WHATSAPP_INBOUND_N8N_TOKEN` na Vercel.
