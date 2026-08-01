import { inspectN8nWorkflows } from '../../../../../src/lib/n8n-monitoring'
import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'
import {
  isPlatformMercadoPagoConfigured,
  sanitizePlatformPaymentAccount,
  type PlatformPaymentAccountRow,
} from '../../../../../src/lib/payments/platform-mercado-pago'

type PendingCategory = {
  id: string
  title: string
  description: string
  count: number
  href: string
  action: string
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error

  const [
    legacySignupsResult,
    publicSignupsResult,
    staffRequestsResult,
    paymentsResult,
    contactMessagesResult,
    whatsappThreadsResult,
    incidentHistoryResult,
    officialPaymentAccountResult,
    operations,
  ] = await Promise.all([
    result.supabase.rpc('admin_list_pending_signups'),
    result.supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('billing_type', 'public_signup_request')
      .eq('status', 'pending')
      .is('deleted_at', null),
    result.supabase
      .from('tenant_staff_addition_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    result.supabase
      .from('payments')
      .select('id, billing_type')
      .eq('status', 'pending')
      .is('deleted_at', null),
    result.supabase
      .from('platform_contact_messages')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'read']),
    result.supabase
      .from('platform_whatsapp_threads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gt('unread_count', 0),
    result.supabase
      .from('platform_operational_incidents')
      .select('id, severity, title, status, first_detected_at, last_detected_at, resolved_at')
      .order('last_detected_at', { ascending: false })
      .limit(10),
    result.supabase
      .from('platform_payment_provider_accounts')
      .select(
        'provider, status, provider_account_id, provider_account_name, credential_source, metadata, connected_at, last_validated_at, last_error_code'
      )
      .eq('provider', 'mercado_pago')
      .maybeSingle(),
    inspectN8nWorkflows(),
  ])

  const warnings: string[] = []
  if (legacySignupsResult.error) warnings.push('legacy_signups')
  if (publicSignupsResult.error) warnings.push('public_signups')
  if (staffRequestsResult.error) warnings.push('staff_requests')
  if (paymentsResult.error) warnings.push('payments')
  if (contactMessagesResult.error) warnings.push('contact_messages')
  if (whatsappThreadsResult.error) warnings.push('whatsapp_threads')
  if (incidentHistoryResult.error) warnings.push('incident_history')
  if (officialPaymentAccountResult.error) warnings.push('official_payment_account')

  const signupCount =
    (legacySignupsResult.data?.length ?? 0) + (publicSignupsResult.count ?? 0)
  const staffCount = staffRequestsResult.count ?? 0
  const paymentCount = (paymentsResult.data ?? []).filter(
    (payment) => payment.billing_type !== 'public_signup_request'
  ).length
  const contactCount = contactMessagesResult.count ?? 0
  const whatsappCount = whatsappThreadsResult.count ?? 0

  const categories: PendingCategory[] = [
    {
      id: 'signups',
      title: 'Novas contas',
      description: 'Cadastros aguardando aprovação ou recusa.',
      count: signupCount,
      href: '/platform/signups',
      action: 'Revisar cadastros',
    },
    {
      id: 'staff',
      title: 'Profissionais adicionais',
      description: 'Solicitações que precisam ser aprovadas ou recusadas.',
      count: staffCount,
      href: '/platform/staff-addition-requests',
      action: 'Revisar solicitações',
    },
    {
      id: 'payments',
      title: 'Pagamentos da plataforma',
      description: 'Cobranças aguardando confirmação ou exclusão.',
      count: paymentCount,
      href: '/platform/payments',
      action: 'Conferir pagamentos',
    },
    {
      id: 'contact',
      title: 'Mensagens de contato',
      description: 'Mensagens abertas que ainda precisam de tratamento.',
      count: contactCount,
      href: '/platform/contact-messages',
      action: 'Ler mensagens',
    },
    {
      id: 'whatsapp',
      title: 'WhatsApp do Jack',
      description: 'Conversas com mensagens não lidas aguardando resposta.',
      count: whatsappCount,
      href: '/platform/whatsapp-inbox',
      action: 'Responder conversas',
    },
  ]

  const administrativeCount = categories.reduce((total, category) => total + category.count, 0)
  const operationalCount = operations.issues.length + warnings.length

  return Response.json({
    total: administrativeCount + operationalCount,
    administrativeCount,
    operationalCount,
    hasCritical:
      warnings.length > 0 ||
      operations.issues.some((issue) => issue.severity === 'critical'),
    categories,
    operations: {
      ...operations,
      history: incidentHistoryResult.data ?? [],
    },
    officialPaymentProviderConfigured: isPlatformMercadoPagoConfigured(),
    officialPaymentAccount: officialPaymentAccountResult.error
      ? null
      : sanitizePlatformPaymentAccount(
          officialPaymentAccountResult.data as PlatformPaymentAccountRow | null
        ),
    warnings,
  })
}
