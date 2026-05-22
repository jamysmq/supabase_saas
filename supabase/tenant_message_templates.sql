create table if not exists public.tenant_message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_key text not null,
  channel text not null default 'whatsapp',
  content text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_message_templates
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists template_key text,
  add column if not exists channel text not null default 'whatsapp',
  add column if not exists content text not null default '',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists tenant_message_templates_tenant_key_idx
on public.tenant_message_templates (tenant_id, template_key);

create index if not exists tenant_message_templates_tenant_active_idx
on public.tenant_message_templates (tenant_id, is_active);

insert into public.tenant_message_templates (
  tenant_id,
  template_key,
  channel,
  content,
  is_active
)
select
  t.id,
  defaults.template_key,
  'whatsapp',
  defaults.content,
  true
from public.tenants t
cross join (
  values
    (
      'billing_reminder_due_today',
      'Ola, {{customer_name}}! Aqui e o Assistente Jack, de {{tenant_name}}. Sua mensalidade de {{amount}} vence em {{due_date}}. Pix: {{pix_key}}.'
    ),
    (
      'appointment_welcome',
      'Ola! Eu sou o Assistente Jack, de {{tenant_name}}. Me diga o servico e o melhor dia para voce.'
    ),
    (
      'appointment_confirmation_reminder',
      'Ola, {{customer_name}}! Aqui e o Assistente Jack, de {{tenant_name}}. Confirmando seu horario em {{appointment_date}} as {{appointment_time}}. Responda 1 para confirmar, 2 para remarcar ou 3 para cancelar.'
    ),
    (
      'restaurant_welcome',
      'Ola! Eu sou o Assistente Jack, de {{tenant_name}}. Me diga se voce quer ver o cardapio ou fazer um pedido.'
    )
) as defaults(template_key, content)
where not exists (
  select 1
  from public.tenant_message_templates existing
  where existing.tenant_id = t.id
    and existing.template_key = defaults.template_key
);

alter table public.tenant_message_templates enable row level security;

grant select, insert, update
on public.tenant_message_templates
to authenticated;

grant select, insert, update, delete
on public.tenant_message_templates
to service_role;

drop policy if exists "tenant_message_templates_manage_own_tenant" on public.tenant_message_templates;
create policy "tenant_message_templates_manage_own_tenant"
on public.tenant_message_templates
for all
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_message_templates.tenant_id
      and tu.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_message_templates.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);
