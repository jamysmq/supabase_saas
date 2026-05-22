-- Update default WhatsApp copy to use the Assistente Jack persona.
-- This intentionally updates only messages that still match previous defaults.

update public.tenant_message_templates
set
  content = 'Ola, {{customer_name}}! Aqui e o Assistente Jack, de {{tenant_name}}. Sua mensalidade de {{amount}} vence em {{due_date}}. Pix: {{pix_key}}.',
  updated_at = now()
where template_key = 'billing_reminder_due_today'
  and content = 'Ola, {{customer_name}}! Sua mensalidade de {{amount}} vence em {{due_date}}. Pix: {{pix_key}}.';

update public.tenant_message_templates
set
  content = 'Ola! Eu sou o Assistente Jack, de {{tenant_name}}. Me diga o servico e o melhor dia para voce.',
  updated_at = now()
where template_key = 'appointment_welcome'
  and content = 'Ola! Eu sou o assistente de agendamento de {{tenant_name}}. Me diga o servico e o melhor dia para voce.';

update public.tenant_message_templates
set
  content = 'Ola, {{customer_name}}! Aqui e o Assistente Jack, de {{tenant_name}}. Confirmando seu horario em {{appointment_date}} as {{appointment_time}}. Responda 1 para confirmar, 2 para remarcar ou 3 para cancelar.',
  updated_at = now()
where template_key = 'appointment_confirmation_reminder'
  and content = 'Ola, {{customer_name}}! Confirmando seu horario em {{appointment_date}} as {{appointment_time}} com {{tenant_name}}. Responda 1 para confirmar, 2 para remarcar ou 3 para cancelar.';

update public.tenant_message_templates
set
  content = 'Ola! Eu sou o Assistente Jack, de {{tenant_name}}. Me diga se voce quer ver o cardapio ou fazer um pedido.',
  updated_at = now()
where template_key = 'restaurant_welcome'
  and content = 'Ola! Bem-vindo ao {{tenant_name}}. Me diga se voce quer ver o cardapio ou fazer um pedido.';
