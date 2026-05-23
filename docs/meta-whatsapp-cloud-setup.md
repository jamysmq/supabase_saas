# Meta WhatsApp Cloud API Setup

Este guia prepara a conta Meta para integrar o app com a WhatsApp Cloud API oficial.

## Antes de Comecar

- Use uma conta Meta com acesso ao Business Manager/Business Suite do negocio.
- Tenha um numero de telefone que possa ser usado no WhatsApp Business Platform.
- Evite usar um numero pessoal ja ativo no WhatsApp comum.
- Tenha o dominio/URL publica do app definido, por exemplo:

```text
https://app.seudominio.com
```

## 1. Criar ou Abrir o App Meta

1. Acesse `https://developers.facebook.com/apps`.
2. Clique em criar app.
3. Escolha um app do tipo Business/Negocios, se a Meta pedir o tipo.
4. Vincule o app ao Business Portfolio correto.
5. No painel do app, adicione o produto WhatsApp.

## 2. Pegar Dados Iniciais do WhatsApp

No produto WhatsApp, abra API Setup/Configuracao da API e anote:

- `Phone Number ID`;
- `WhatsApp Business Account ID`;
- numero de teste ou numero real conectado;
- token temporario, apenas para validar se a conta esta funcionando.

No nosso app, o `Phone Number ID` vira:

```env
WHATSAPP_CLOUD_PHONE_NUMBER_ID=
```

## 3. Testar Envio Pelo Painel da Meta

1. Adicione seu telefone como destinatario de teste, se estiver usando o numero de teste da Meta.
2. Envie a mensagem de teste pelo proprio painel da Meta.
3. Confirme que a mensagem chegou no WhatsApp.

Esse teste valida a conta Meta antes de envolver nosso app.

## 4. Criar Token Permanente

Para producao, nao use token temporario.

1. Acesse Business Settings/Configuracoes do negocio.
2. Abra Users/Usuarios > System Users/Usuarios do sistema.
3. Crie um usuario de sistema.
4. Dê acesso ao app Meta e ao WhatsApp Business Account.
5. Gere um token permanente com permissoes:

```text
whatsapp_business_messaging
whatsapp_business_management
```

No nosso app, o token vira:

```env
WHATSAPP_CLOUD_ACCESS_TOKEN=
```

## 5. Configurar App Secret

No painel do app Meta, em configuracoes basicas, copie o App Secret.

No nosso app, ele vira:

```env
WHATSAPP_APP_SECRET=
```

Ele e usado para validar a assinatura `x-hub-signature-256` dos webhooks recebidos.

## 6. Criar Verify Token

Escolha um segredo longo, aleatorio, criado por voce. Ele precisa ser igual na Meta e no app.

No nosso app:

```env
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
```

Na Meta:

```text
Verify Token = mesmo valor
```

## 7. Configurar Webhook na Meta

Depois do deploy na Vercel, a callback URL sera:

```text
https://app.seudominio.com/api/whatsapp/webhook
```

No painel da Meta:

1. Abra WhatsApp > Configuration/Webhooks.
2. Informe a callback URL.
3. Informe o verify token.
4. Salve e aguarde a Meta validar o challenge.
5. Inscreva o webhook em eventos de mensagens e status, quando a tela pedir.

Nosso endpoint ja aceita:

- `GET /api/whatsapp/webhook` para challenge;
- `POST /api/whatsapp/webhook` para mensagens/status assinados.

## 8. Configurar Vercel

Na Vercel, configure:

```env
WHATSAPP_CLOUD_ACCESS_TOKEN=
WHATSAPP_CLOUD_PHONE_NUMBER_ID=
WHATSAPP_CLOUD_GRAPH_VERSION=v23.0
WHATSAPP_PUBLIC_PHONE_E164=
WHATSAPP_INTERNAL_SEND_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_INBOUND_N8N_WEBHOOK_URL=
WHATSAPP_INBOUND_N8N_TOKEN=
```

## 9. Configurar n8n

No container n8n:

```env
APP_BASE_URL=https://app.seudominio.com
WHATSAPP_INTERNAL_SEND_TOKEN=
```

`WHATSAPP_INTERNAL_SEND_TOKEN` deve ser o mesmo valor configurado na Vercel.

## 10. Teste Final

1. Acesse `https://app.seudominio.com/api/health`.
2. Teste o envio real pelo endpoint interno do app, sem expor token em chat/log.
3. Envie uma mensagem real para o numero WhatsApp conectado.
4. Confirme no log da Vercel que o webhook recebeu a mensagem.
5. Confirme no n8n que o workflow inbound recebeu o payload normalizado.
6. Faça um fluxo real de agendamento com tenant `plan2` ou `plan3`.

## Fontes Oficiais

- Meta for Developers: `https://developers.facebook.com/`
- WhatsApp Cloud API: `https://developers.facebook.com/docs/whatsapp/cloud-api`
- Webhooks Meta: `https://developers.facebook.com/docs/graph-api/webhooks/`
