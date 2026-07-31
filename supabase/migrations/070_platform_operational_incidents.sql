create table if not exists public.platform_operational_incidents (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'n8n',
  incident_key text not null unique,
  severity text not null,
  title text not null,
  description text not null,
  workflow_id text,
  workflow_name text,
  execution_id text,
  status text not null default 'active',
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz,
  resolution_notified_at timestamptz,
  notification_attempts integer not null default 0,
  provider_message_id text,
  last_notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_operational_incidents_severity_chk
    check (severity in ('critical', 'warning')),
  constraint platform_operational_incidents_status_chk
    check (status in ('active', 'resolved')),
  constraint platform_operational_incidents_attempts_chk
    check (notification_attempts >= 0)
);

create index if not exists platform_operational_incidents_status_detected_idx
on public.platform_operational_incidents (status, last_detected_at desc);

alter table public.platform_operational_incidents enable row level security;

revoke all on table public.platform_operational_incidents from public, anon, authenticated;
grant select, insert, update on table public.platform_operational_incidents to service_role;

comment on table public.platform_operational_incidents is
  'Persistent incidents detected by background operational monitors. Access is server-only.';
