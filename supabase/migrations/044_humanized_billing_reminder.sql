-- Fixes the tenant billing reminder copy to match the official Meta template.

update public.tenant_message_templates
set content = E'Olá, {{customer_name}}! 😊\n\nPassando para lembrar que sua mensalidade com {{tenant_name}}, no valor de {{amount}}, vence em {{due_date}}.\n\n💳 Chave Pix: {{pix_key}}\n\nSe você já realizou o pagamento, pode desconsiderar esta mensagem.\n\nEm caso de dúvida, fale com a equipe de {{tenant_name}}. Estamos à disposição!',
    updated_at = now()
where template_key = 'billing_reminder_due_today'
  and channel = 'whatsapp';
