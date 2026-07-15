-- Removes the second legacy global chat uniqueness rule found in production.
-- Completed conversations remain stored, while only one open conversation is
-- allowed for the same tenant and customer.

alter table public.wa_conversations
drop constraint if exists ux_wa_conversations_chat_id;

drop index if exists public.ux_wa_conversations_chat_id;

create unique index if not exists wa_conversations_active_chat_uq
on public.wa_conversations (tenant_id, chat_id)
where coalesce(is_closed, false) = false;
