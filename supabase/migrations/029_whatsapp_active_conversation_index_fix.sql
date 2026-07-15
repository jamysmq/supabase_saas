-- Fixes environments where wa_conversations_chat_uq was created as a
-- standalone index. Migration 028 originally removed only the constraint
-- representation, leaving the permanent chat uniqueness rule in place.

alter table public.wa_conversations
drop constraint if exists wa_conversations_chat_uq;

alter table public.wa_conversations
drop constraint if exists ux_wa_conversations_chat_id;

drop index if exists public.wa_conversations_chat_uq;
drop index if exists public.ux_wa_conversations_chat_id;

create unique index if not exists wa_conversations_active_chat_uq
on public.wa_conversations (tenant_id, chat_id)
where coalesce(is_closed, false) = false;
