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
