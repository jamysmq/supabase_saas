# WhatsApp go-live runbook

Use este roteiro quando a Meta aprovar o app e o numero oficial puder operar em producao.

## 1. Meta para app

No painel da Meta, configure o webhook oficial:

- Callback URL: `https://app.meuassistentevirtual.com.br/api/whatsapp/webhook`
- Verify token: mesmo valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN` na Vercel
- Campos inscritos: `messages` e status/eventos de mensagem que forem necessarios

## 2. App para n8n

A Vercel usa uma unica URL de inbound para n8n:

```env
WHATSAPP_INBOUND_N8N_WEBHOOK_URL=
WHATSAPP_INBOUND_N8N_TOKEN=
```

`WHATSAPP_INBOUND_N8N_WEBHOOK_URL` deve apontar para uma entrada central/roteador de inbound no n8n. Nao aponte diretamente para `WA_TENANT_APPOINTMENTS_INBOUND_v1` ou `WA_TENANT_BILLING_SIGNUP_INBOUND_v1`, porque esses sao workflows de modulo.

Roteador central criado:

- Workflow: `WA_INBOUND_ROUTER_v1`
- ID remoto n8n: `JSlq95lyTAVjZjtz`
- Production path: `/webhook/wa-inbound-router-v1`
- Menu numerado:
  - `1`: agenda (`WA_TENANT_APPOINTMENTS_INBOUND_v1`)
  - `2`: cadastro/mensalidades (`WA_TENANT_BILLING_SIGNUP_INBOUND_v1`)
  - `3`: atendimento humano
- Se a mensagem nao bater em numero nem fallback de palavra-chave, o roteador retorna o texto do menu numerado.
- O roteador tambem retorna `target_webhook_path` para os modulos de agenda/cadastro.
- O disparo automatico de modulo fica bloqueado ate `WA_INBOUND_ROUTER_DISPATCH_ENABLED=true` estar configurado no n8n.

`WHATSAPP_INBOUND_N8N_TOKEN` e um segredo criado por nos. O app envia esse valor no header `Authorization: Bearer <token>` quando encaminha eventos para o n8n.

Payload que o n8n recebe do app:

```json
{
  "provider": "whatsapp_cloud",
  "phone_number_id": "123456789",
  "tenant_phone_e164": "5583999999999",
  "to": "5583999999999",
  "from": "5583888888888",
  "customer_phone_e164": "5583888888888",
  "chat_id": "5583888888888",
  "message_id": "wamid...",
  "inbox_thread_id": "uuid-da-thread-ou-null",
  "inbox_routed": true,
  "text": "Oi",
  "message": "Oi",
  "timestamp": "1770000000"
}
```

## 3. Workflows n8n atuais

- `DAILY_BILLING_REMINDERS` (`YbD6NHWbgz9vLe33w_UU-`): ativo.
- `WA_INBOUND_ROUTER_v1` (`JSlq95lyTAVjZjtz`): ativo para receber/testar a entrada central.
- `WA_TENANT_APPOINTMENTS_INBOUND_v1` (`X1lUop6Q5fh9uxTG`): ativo em teste controlado desde 2026-07-14; nao desativar sem registrar incidente ou rollback.
- `DAILY_APPOINTMENT_CONFIRMATION_REMINDERS` (`zWflZZXKn2XIlHEc`): manter inativo ate teste controlado.
- `DAILY_TENANT_AGENDA_REMINDERS` (`dcKARQX6GDCBPo3W`): manter inativo ate teste controlado.
- `WA_TENANT_BILLING_SIGNUP_INBOUND_v1` (`A4XOl16nkcIYOre1`): manter inativo ate teste controlado.

## 4. Sequencia segura de ativacao

1. Confirmar que envio manual pela inbox funciona.
2. Confirmar que resposta real chega em `/api/whatsapp/webhook` e aparece na inbox.
3. Configurar `WHATSAPP_INBOUND_N8N_WEBHOOK_URL` na Vercel apontando para `/webhook/wa-inbound-router-v1`.
4. Manter `salaoteste@teste.com` como tenant de validacao da agenda antes de liberar mudancas amplas.
5. Repetir o fluxo real de criar, remarcar e cancelar apos mudancas no roteador, no adaptador ou no workflow de agenda.
6. Ativar os demais workflows de modulo um por vez, testando logs e mensagens reais antes de liberar para mais tenants.
7. Manter o dispatch do roteador limitado aos modulos ja validados e registrar qualquer nova ativacao neste runbook.
