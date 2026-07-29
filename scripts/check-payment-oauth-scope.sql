begin;

do $$
declare
  first_user record;
  other_user record;
  first_state_hash text := encode(gen_random_bytes(32), 'hex');
begin
  select id, tenant_id
    into first_user
  from public.tenant_users
  order by created_at
  limit 1;

  select id, tenant_id
    into other_user
  from public.tenant_users
  where tenant_id <> first_user.tenant_id
  order by created_at
  limit 1;

  if first_user.id is null or other_user.id is null then
    raise exception 'two_tenant_users_required';
  end if;

  insert into public.tenant_payment_provider_oauth_states (
    id,
    tenant_id,
    tenant_user_id,
    provider,
    state_hash,
    code_verifier_ciphertext,
    redirect_uri,
    expires_at
  )
  values (
    gen_random_uuid(),
    first_user.tenant_id,
    first_user.id,
    'mercado_pago',
    first_state_hash,
    'encrypted-test-value',
    'https://example.com/callback',
    now() + interval '10 minutes'
  );

  begin
    insert into public.tenant_payment_provider_oauth_states (
      id,
      tenant_id,
      tenant_user_id,
      provider,
      state_hash,
      code_verifier_ciphertext,
      redirect_uri,
      expires_at
    )
    values (
      gen_random_uuid(),
      first_user.tenant_id,
      first_user.id,
      'mercado_pago',
      first_state_hash,
      'encrypted-test-value',
      'https://example.com/callback',
      now() + interval '10 minutes'
    );

    raise exception 'duplicate_state_was_not_rejected';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.tenant_payment_provider_oauth_states (
      id,
      tenant_id,
      tenant_user_id,
      provider,
      state_hash,
      code_verifier_ciphertext,
      redirect_uri,
      expires_at
    )
    values (
      gen_random_uuid(),
      first_user.tenant_id,
      other_user.id,
      'mercado_pago',
      encode(gen_random_bytes(32), 'hex'),
      'encrypted-test-value',
      'https://example.com/callback',
      now() + interval '10 minutes'
    );

    raise exception 'cross_tenant_user_was_not_rejected';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

rollback;

select count(*) as oauth_state_count_after_rollback
from public.tenant_payment_provider_oauth_states;
