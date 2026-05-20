# Vercel Deploy Checklist

Decisao de arquitetura: o app Next.js sera publicado na Vercel Pro para evitar uma migracao de plataforma no curto prazo. Supabase e n8n continuam como servicos externos.

## Dominios

Estrutura recomendada:

- `app.seudominio.com`: SaaS principal.
- `seudominio.com` e `www.seudominio.com`: site institucional/landing futura.

O webhook oficial da Meta deve usar:

```text
https://app.seudominio.com/api/whatsapp/webhook
```

## Projeto Vercel

1. Criar uma conta/time Pro na Vercel.
2. Importar o repositorio GitHub `jamysmq/supabase_saas`.
3. Usar os defaults do framework Next.js:
   - build command: `npm run build`;
   - install command: `npm install`;
   - output directory: automatico pelo Next.js.
4. Configurar as variaveis de ambiente em Production antes do primeiro deploy real.
5. Fazer deploy.
6. Validar:

```text
https://app.seudominio.com/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "billing-app",
  "timestamp": "..."
}
```

## Variaveis do app na Vercel

Obrigatorias para o app:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Obrigatorias para envio/recebimento WhatsApp quando a Meta liberar:

```env
WHATSAPP_CLOUD_ACCESS_TOKEN=
WHATSAPP_CLOUD_PHONE_NUMBER_ID=
WHATSAPP_CLOUD_GRAPH_VERSION=v23.0
WHATSAPP_INTERNAL_SEND_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
```

Obrigatorias para encaminhar inbound da Meta ao n8n:

```env
WHATSAPP_INBOUND_N8N_WEBHOOK_URL=
WHATSAPP_INBOUND_N8N_TOKEN=
```

Opcionais para administracao local/remota de n8n:

```env
N8N_BASE_URL=
N8N_API_KEY=
```

## Variaveis no n8n Docker

Manter:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Adicionar quando o app estiver publicado:

```env
APP_BASE_URL=https://app.seudominio.com
WHATSAPP_INTERNAL_SEND_TOKEN=
```

`WHATSAPP_INTERNAL_SEND_TOKEN` precisa ser o mesmo segredo configurado na Vercel.

## Ordem Segura de Go-Live

1. Publicar app na Vercel com envs Supabase.
2. Validar `/api/health`.
3. Validar login plataforma e tenant.
4. Configurar dominio final e HTTPS.
5. Configurar envs WhatsApp na Vercel, exceto token real se a Meta ainda nao liberou.
6. Configurar `APP_BASE_URL` e `WHATSAPP_INTERNAL_SEND_TOKEN` no n8n.
7. Importar/atualizar workflows n8n versionados somente depois que `APP_BASE_URL` estiver respondendo.
8. Quando a Meta liberar:
   - configurar token/phone number id/app secret;
   - cadastrar webhook `https://app.seudominio.com/api/whatsapp/webhook`;
   - testar challenge da Meta;
   - testar uma mensagem real de entrada;
   - testar envio real pelo endpoint interno.
9. Fazer primeiro go-live controlado com um tenant `plan2` ou `plan3`.

## Decisoes Para Nao Reverter Depois

- Manter Supabase como banco e Auth.
- Manter n8n como orquestrador dos workflows WhatsApp.
- Manter app Next.js como camada publica, API segura e receptor oficial dos webhooks Meta.
- Manter Vercel como plataforma do app enquanto o produto cresce; evitar VPS temporario para o app principal.
- Nao gravar tokens no codigo, workflow JSON ou chat; usar somente envs.

