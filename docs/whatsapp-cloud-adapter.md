# WhatsApp Cloud API Adapter

O projeto usa um adaptador interno para envio pela WhatsApp Cloud API oficial da Meta, evitando espalhar token, `phone_number_id` e formato de payload pelos workflows.

## Variaveis de ambiente

- `WHATSAPP_CLOUD_ACCESS_TOKEN`: token da Meta com permissao de envio.
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`: ID do numero remetente no WhatsApp Business Account.
- `WHATSAPP_CLOUD_GRAPH_VERSION`: versao da Graph API, opcional. Padrao atual do app: `v23.0`.
- `WHATSAPP_INTERNAL_SEND_TOKEN`: segredo interno para autorizar chamadas ao endpoint de envio.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: segredo informado tambem no painel da Meta para verificar a URL de callback.
- `WHATSAPP_APP_SECRET`: App Secret da Meta, usado para validar `x-hub-signature-256` nos webhooks recebidos.

## Endpoint interno

`POST /api/internal/whatsapp/send`

Headers:

- `Authorization: Bearer <WHATSAPP_INTERNAL_SEND_TOKEN>`
- `Content-Type: application/json`

Body:

```json
{
  "to": "5583999999999",
  "body": "Mensagem de teste",
  "preview_url": false
}
```

Resposta esperada:

```json
{
  "ok": true,
  "provider": "whatsapp_cloud",
  "message_id": "wamid...",
  "wa_id": "5583999999999"
}
```

## Contrato para n8n

Os workflows devem chamar esse endpoint interno quando o app estiver publicado e acessivel pelo n8n. Ate la, os mocks de envio continuam uteis para validar a logica sem consumir a API real.

Esse endpoint envia apenas texto livre. Templates aprovados, midias, botoes/listas e webhooks de status devem entrar como proximas evolucoes do adaptador, mantendo o mesmo principio: workflow generico, tenant/template/dados vindos do Supabase, provedor isolado em uma camada unica.

## Webhook oficial da Meta

`GET /api/whatsapp/webhook`

Usado pela Meta para verificar a URL. A Meta chama a URL com `hub.mode`, `hub.verify_token` e `hub.challenge`. O app compara `hub.verify_token` com `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e devolve o `hub.challenge` em texto puro quando estiver correto.

`POST /api/whatsapp/webhook`

Recebe mensagens e status enviados pela Meta. O app valida `x-hub-signature-256` usando `WHATSAPP_APP_SECRET`, normaliza eventos de mensagem/status e responde rapidamente. O encaminhamento desses eventos para n8n deve ser conectado na proxima etapa, depois que a URL publica do app e as envs finais estiverem prontas.

URL para cadastrar na Meta, depois do deploy:

```text
https://SEU_DOMINIO/api/whatsapp/webhook
```
