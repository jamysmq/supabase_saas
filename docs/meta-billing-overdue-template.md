# Template oficial de cobrança vencida

O workflow `DAILY_BILLING_REMINDERS` usa um template separado quando a mensalidade já venceu. Ele só deve ser publicado no n8n depois que este template estiver aprovado pela Meta.

## Configuração na Meta

- Nome: `jack_billing_overdue_reminder_v1`
- Categoria: `UTILITY`
- Idioma: `Português (BR)` / `pt_BR`
- Cabeçalho: nenhum
- Rodapé: nenhum
- Botões: nenhum

## Estado na Meta

- Submetido em produção em 19/07/2026.
- ID: `1008513205307809`.
- Status atual: `APPROVED`.
- Aprovação confirmada em produção em 19/07/2026.

Corpo:

```text
Olá, {{1}}! 😊

Passando para lembrar que sua mensalidade com {{2}}, no valor de {{3}}, venceu em {{4}} e está pendente.

Chave Pix: {{5}}

Se você já realizou o pagamento, pode desconsiderar esta mensagem.

Em caso de dúvida, fale com a equipe de {{2}}. Estamos à disposição!
```

Exemplos para a análise:

1. `Maria da Silva`
2. `Professor Teste`
3. `R$ 49,90`
4. `10/07/2026`
5. `11999999999`

A ordem dos cinco parâmetros é a mesma usada pelo template vigente `jack_billing_due_reminder_v2`.
O parâmetro `{{2}}` é reutilizado no encerramento e não cria um sexto parâmetro.

## Revisões submetidas em 19/07/2026

- `jack_billing_due_reminder_v3`, ID `1041055674977367`, status `APPROVED`: usa “vence hoje ({{4}})”.
- `jack_billing_overdue_reminder_v2`, ID `2124744398115629`, status `APPROVED`: mantém “venceu em {{4}} e está pendente”.
- Ambas usam um único emoji e terminam visualmente com `equipe de {{2}}. 😊`.
- A Meta recusou a primeira proposta que terminava diretamente em `{{2}}`, pois variáveis não podem ficar no início ou no fim do template (`2388299`).
- As versões novas foram publicadas no workflow após a confirmação de `APPROVED`.

## Botão de atendimento submetido em 21/07/2026

- A Meta bloqueia links diretos para `wa.me` em botões de template (`2388081`).
- O botão “Falar com a equipe” usa uma URL dinâmica do domínio `app.meuassistentevirtual.com.br`, que resolve o tenant ativo e redireciona para seu `whatsapp_e164`.
- `jack_billing_due_reminder_v4`, ID `2264704294377701`, status inicial `PENDING`.
- `jack_billing_overdue_reminder_v3`, ID `1392925799394393`, status inicial `PENDING`.
- Tenants sem WhatsApp válido permanecem nas versões aprovadas sem botão.
