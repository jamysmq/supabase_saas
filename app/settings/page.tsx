'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { clearPublicSessionMarker } from '../../src/lib/public-session'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'

type Tenant = {
  id: string
  legal_name: string
  public_name: string | null
  email: string
  whatsapp_e164: string
  plan: string
  status: string
}

type BillingSettings = {
  pix_key: string | null
  pix_key_type: string | null
  pix_beneficiary_name: string | null
  pix_beneficiary_city: string | null
  pix_collection_mode: string | null
  payment_automation_enabled: boolean | null
  default_payment_provider: string | null
  timezone: string | null
  max_customer_groups: number | null
}

type TenantUser = {
  tenant_id: string
  role: string
  email: string
  must_change_password: boolean
}

type PaymentProviderConnection = {
  id: string
  status: string
  provider_account_id: string | null
  provider_account_name: string | null
  granted_scopes: string[]
  token_expires_at: string | null
  connected_at: string | null
  last_error_code: string | null
}

export default function SettingsPage() {
  const router = useRouter()

  const [tenantUser, setTenantUser] = useState<TenantUser | null>(null)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
  const [mercadoPagoConfigured, setMercadoPagoConfigured] = useState(false)
  const [mercadoPagoWebhookConfigured, setMercadoPagoWebhookConfigured] =
    useState(false)
  const [mercadoPagoConnection, setMercadoPagoConnection] =
    useState<PaymentProviderConnection | null>(null)
  const [profileForm, setProfileForm] = useState({
    legal_name: '',
    public_name: '',
    email: '',
    whatsapp_e164: '',
  })
  const [pixForm, setPixForm] = useState({
    pix_key: '',
    pix_key_type: 'cpf',
    pix_beneficiary_name: '',
    pix_beneficiary_city: '',
  })
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [loading, setLoading] = useState(true)
  const [savingPix, setSavingPix] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [connectingMercadoPago, setConnectingMercadoPago] = useState(false)
  const [disconnectingMercadoPago, setDisconnectingMercadoPago] = useState(false)
  const [savingPaymentAutomation, setSavingPaymentAutomation] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const labels = getBusinessLabels(businessType)

  const load = useCallback(async function load() {
    setLoading(true)
    setError('')
    setSuccess('')

    const result = await getCurrentTenantUser()

    if (!result) {
      router.push('/login')
      return
    }

    if (result.tenantUser.must_change_password) {
      router.push('/change-password')
      return
    }

    setTenantUser(result.tenantUser)
    setBusinessType(result.tenant?.business_type ?? null)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const [tenantResult, settingsResult, mercadoPagoResponse] = await Promise.all([
      supabase
        .from('tenants')
        .select('id, legal_name, public_name, email, whatsapp_e164, plan, status')
        .eq('id', result.tenantUser.tenant_id)
        .single(),
      supabase
        .from('tenant_billing_settings')
        .select('pix_key, pix_key_type, pix_beneficiary_name, pix_beneficiary_city, pix_collection_mode, payment_automation_enabled, default_payment_provider, timezone, max_customer_groups')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .maybeSingle(),
      fetch('/api/payment-providers/mercado-pago/connection', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }),
    ])

    if (tenantResult.error) {
      setError('Não foi possível carregar as configurações.')
      setLoading(false)
      return
    }

    setTenant(tenantResult.data)
    setProfileForm({
      legal_name: tenantResult.data.legal_name,
      public_name: tenantResult.data.public_name ?? tenantResult.data.legal_name,
      email: tenantResult.data.email ?? '',
      whatsapp_e164: tenantResult.data.whatsapp_e164 ?? '',
    })
    setBillingSettings(settingsResult.data ?? null)
    const mercadoPagoPayload = await mercadoPagoResponse.json().catch(() => null)
    setMercadoPagoConfigured(
      mercadoPagoResponse.ok && mercadoPagoPayload?.configured === true
    )
    setMercadoPagoWebhookConfigured(
      mercadoPagoResponse.ok &&
        mercadoPagoPayload?.webhook_configured === true
    )
    setMercadoPagoConnection(
      mercadoPagoResponse.ok ? mercadoPagoPayload?.connection ?? null : null
    )
    setPixForm({
      pix_key: settingsResult.data?.pix_key ?? '',
      pix_key_type: settingsResult.data?.pix_key_type ?? 'cpf',
      pix_beneficiary_name: settingsResult.data?.pix_beneficiary_name ?? '',
      pix_beneficiary_city: settingsResult.data?.pix_beneficiary_city ?? '',
    })

    const paymentConnectionResult = new URLSearchParams(
      window.location.search
    ).get('payment_connection')

    if (paymentConnectionResult) {
      const successMessages: Record<string, string> = {
        connected: 'Conta Mercado Pago conectada com segurança.',
        cancelled: 'A conexão com o Mercado Pago foi cancelada.',
      }
      const errorMessages: Record<string, string> = {
        expired: 'A tentativa de conexão expirou. Inicie novamente.',
        invalid_callback: 'O retorno do Mercado Pago ficou incompleto.',
        invalid_state: 'Não foi possível validar a tentativa de conexão.',
        redirect_mismatch: 'A URL de retorno do Mercado Pago não confere.',
        production_required: 'Use uma conta e credenciais de produção do Mercado Pago.',
        account_in_use: 'Esta conta Mercado Pago já está conectada a outro estabelecimento.',
        connection_failed: 'Não foi possível concluir a conexão com o Mercado Pago.',
      }

      if (successMessages[paymentConnectionResult]) {
        setSuccess(successMessages[paymentConnectionResult])
      } else if (errorMessages[paymentConnectionResult]) {
        setError(errorMessages[paymentConnectionResult])
      }

      window.history.replaceState({}, '', window.location.pathname)
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    setSavingProfile(true)
    setError('')
    setSuccess('')

    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setSavingProfile(false)
      router.push('/login')
      return
    }

    const response = await fetch('/api/tenant-profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(profileForm),
    })

    setSavingProfile(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Não foi possível salvar os dados do negócio.')
      return
    }

    setSuccess('Dados do negócio atualizados.')
    await load()
  }

  async function savePix(event: React.FormEvent) {
    event.preventDefault()

    if (!tenantUser) return

    setSavingPix(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setSavingPix(false)
      router.push('/login')
      return
    }

    const response = await fetch('/api/tenant-billing-settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pix_key: pixForm.pix_key,
        pix_key_type: pixForm.pix_key_type,
        pix_beneficiary_name: pixForm.pix_beneficiary_name,
        pix_beneficiary_city: pixForm.pix_beneficiary_city,
      }),
    })

    setSavingPix(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Não foi possível salvar os dados de Pix.')
      return
    }

    setSuccess('Dados de Pix atualizados.')
    await load()
  }

  async function connectMercadoPago() {
    setConnectingMercadoPago(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setConnectingMercadoPago(false)
      router.push('/login')
      return
    }

    const response = await fetch(
      '/api/payment-providers/mercado-pago/connection',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    )
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      setConnectingMercadoPago(false)
      setError(
        payload?.message ?? 'Não foi possível iniciar a conexão com o Mercado Pago.'
      )
      return
    }

    try {
      const authorizationUrl = new URL(payload.authorization_url)
      if (
        authorizationUrl.protocol !== 'https:' ||
        authorizationUrl.hostname !== 'auth.mercadopago.com'
      ) {
        throw new Error('Invalid authorization URL.')
      }
      window.location.assign(authorizationUrl.toString())
    } catch {
      setConnectingMercadoPago(false)
      setError('O Mercado Pago retornou uma URL de autorização inválida.')
    }
  }

  async function disconnectMercadoPago() {
    const confirmed = confirm(
      'Desconectar o Mercado Pago? O billing-app deixará de usar os tokens desta conta.'
    )
    if (!confirmed) return

    setDisconnectingMercadoPago(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setDisconnectingMercadoPago(false)
      router.push('/login')
      return
    }

    const response = await fetch(
      '/api/payment-providers/mercado-pago/connection',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    )
    const payload = await response.json().catch(() => null)

    setDisconnectingMercadoPago(false)

    if (!response.ok) {
      setError(payload?.message ?? 'Não foi possível desconectar o Mercado Pago.')
      return
    }

    await load()
    setSuccess('Conta Mercado Pago desconectada do billing-app.')
  }

  async function updatePaymentAutomation(enabled: boolean) {
    const action = enabled ? 'ativar' : 'desativar'
    if (
      !confirm(
        `Deseja ${action} o Pix dinâmico? ${enabled ? 'Os novos QR Codes serão conciliados automaticamente.' : 'O estabelecimento voltará a usar a chave Pix manual.'}`
      )
    ) {
      return
    }

    setSavingPaymentAutomation(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setSavingPaymentAutomation(false)
      router.push('/login')
      return
    }

    const response = await fetch(
      '/api/payment-providers/mercado-pago/automation',
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled }),
      }
    )
    const payload = await response.json().catch(() => null)

    setSavingPaymentAutomation(false)

    if (!response.ok) {
      setError(
        payload?.message ??
          'Não foi possível alterar a automação de pagamentos.'
      )
      return
    }

    setSuccess(
      enabled
        ? 'Pix dinâmico ativado. As confirmações serão conciliadas pelo Mercado Pago.'
        : 'Pix dinâmico desativado. A chave Pix manual voltou a ser o padrão.'
    )
    await load()
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    setSavingPassword(true)
    setError('')
    setSuccess('')

    if (!passwordForm.current_password) {
      setError('Informe a senha atual.')
      setSavingPassword(false)
      return
    }

    if (passwordForm.new_password.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.')
      setSavingPassword(false)
      return
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setError('As senhas não conferem.')
      setSavingPassword(false)
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setSavingPassword(false)
      router.push('/login')
      return
    }

    const response = await fetch('/api/tenant-password', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
        confirm_password: passwordForm.confirm_password,
      }),
    })

    setSavingPassword(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel alterar a senha.')
      return
    }

    setPasswordForm({
      current_password: '',
      new_password: '',
      confirm_password: '',
    })
    setSuccess('Senha atualizada.')
  }

  async function logout() {
    await supabase.auth.signOut()
    clearPublicSessionMarker()
    window.location.assign('https://www.meuassistentevirtual.com.br/')
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <h1 className="text-2xl font-bold">Configurações</h1>
          <p className="text-sm text-gray-500 mt-1">
            Ajuste sua conta, Pix e dados de acesso.
          </p>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-700 rounded-xl p-4 text-sm">
            {success}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <form onSubmit={saveProfile} className="bg-white rounded-2xl shadow p-5 space-y-4">
              <div>
                <h2 className="font-bold">Identidade e contato do negócio</h2>
                <p className="text-sm text-gray-500">
                  O nome fantasia aparece nas mensagens do Jack. O WhatsApp será usado no botão de atendimento humano.
                </p>
              </div>

              <label className="block text-sm font-medium">
                Nome completo ou razão social
                <input
                  value={profileForm.legal_name}
                  onChange={(event) => setProfileForm({ ...profileForm, legal_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Nome fantasia
                <input
                  value={profileForm.public_name}
                  onChange={(event) => setProfileForm({ ...profileForm, public_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                E-mail de contato
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                WhatsApp do estabelecimento
                <input
                  inputMode="tel"
                  value={profileForm.whatsapp_e164}
                  onChange={(event) => setProfileForm({ ...profileForm, whatsapp_e164: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  placeholder="Ex.: 5583999999999"
                  required
                />
                <span className="mt-1 block text-xs font-normal text-gray-500">
                  Informe o número com DDI e DDD. Ele abrirá no botão de atendimento humano do WhatsApp.
                </span>
              </label>

              <button
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={savingProfile}
                type="submit"
              >
                {savingProfile ? 'Salvando...' : 'Salvar dados'}
              </button>
            </form>

            <section className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold">Conta</h2>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-gray-500">Nome fantasia</dt>
                  <dd className="font-medium">{tenant?.public_name ?? tenant?.legal_name ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">E-mail de contato</dt>
                  <dd className="font-medium">{tenant?.email ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">WhatsApp</dt>
                  <dd className="font-medium">{tenant?.whatsapp_e164 ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Plano</dt>
                  <dd className="font-medium">{tenant?.plan ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Status</dt>
                  <dd className="font-medium">{tenant?.status ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Limite de {labels.groupPluralLower}</dt>
                  <dd className="font-medium">
                    {billingSettings?.max_customer_groups ?? 20}
                  </dd>
                </div>
              </dl>
            </section>

            <form onSubmit={savePix} className="bg-white rounded-2xl shadow p-5 space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-bold">Pix de recebimento</h2>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    {billingSettings?.pix_collection_mode === 'provider_dynamic'
                      ? 'Pix dinâmico'
                      : 'Pix manual'}
                  </span>
                </div>
                <p className="text-sm text-gray-500">
                  A chave aparece nas mensagens e gera QR Codes com o valor de cada cobrança.
                  A confirmação do recebimento continua manual.
                </p>
              </div>

              <label className="block text-sm font-medium">
                Nome do beneficiario
                <input
                  value={pixForm.pix_beneficiary_name}
                  onChange={(event) => setPixForm({
                    ...pixForm,
                    pix_beneficiary_name: event.target.value,
                  })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Cidade do beneficiário
                <input
                  value={pixForm.pix_beneficiary_city}
                  onChange={(event) => setPixForm({
                    ...pixForm,
                    pix_beneficiary_city: event.target.value,
                  })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  placeholder="Ex.: Fortaleza"
                  maxLength={60}
                  required
                />
                <span className="mt-1 block text-xs font-normal text-gray-500">
                  Usada na montagem do QR Pix conforme o padrão BR Code.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <label className="block text-sm font-medium">
                  Tipo da chave
                  <select
                    value={pixForm.pix_key_type}
                    onChange={(event) => setPixForm({
                      ...pixForm,
                      pix_key_type: event.target.value,
                    })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  >
                    <option value="cpf">CPF</option>
                    <option value="cnpj">CNPJ</option>
                    <option value="email">E-mail</option>
                    <option value="phone">Telefone</option>
                    <option value="random">Aleatória</option>
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  Chave Pix
                  <input
                    value={pixForm.pix_key}
                    onChange={(event) => setPixForm({
                      ...pixForm,
                      pix_key: event.target.value,
                    })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    required
                  />
                </label>
              </div>

              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                O QR estático facilita o pagamento, mas não consulta o banco. Depois de receber,
                confirme a baixa em Pagamentos pendentes.
              </p>

              <button
                type="submit"
                disabled={savingPix}
                className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
              >
                {savingPix ? 'Salvando...' : 'Salvar Pix'}
              </button>
            </form>

            <section className="space-y-4 rounded-2xl bg-white p-5 shadow">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">Pagamentos automáticos</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Conecte a conta Mercado Pago do próprio estabelecimento sem
                    compartilhar senha ou token com o navegador.
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    mercadoPagoConnection?.status === 'connected'
                      ? 'bg-emerald-50 text-emerald-700'
                      : mercadoPagoConnection?.status === 'needs_reauthorization'
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {mercadoPagoConnection?.status === 'connected'
                    ? 'Conectado'
                    : mercadoPagoConnection?.status === 'needs_reauthorization'
                      ? 'Reconexão necessária'
                      : 'Não conectado'}
                </span>
              </div>

              {mercadoPagoConnection?.status === 'connected' && (
                <dl className="grid gap-3 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Conta autorizada</dt>
                    <dd className="font-medium">
                      {mercadoPagoConnection.provider_account_name ??
                        'Conta Mercado Pago'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Identificador</dt>
                    <dd className="break-all font-mono text-xs">
                      {mercadoPagoConnection.provider_account_id}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">Validade atual do acesso</dt>
                    <dd className="font-medium">
                      {mercadoPagoConnection.token_expires_at
                        ? new Date(
                            mercadoPagoConnection.token_expires_at
                          ).toLocaleDateString('pt-BR')
                        : 'Não informada'}
                    </dd>
                  </div>
                </dl>
              )}

              {!mercadoPagoConfigured && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  A aplicação produtiva do Mercado Pago ainda precisa ser
                  vinculada pela Soft Ink antes da primeira conexão.
                </p>
              )}

              <p className="rounded-xl bg-sky-50 p-3 text-xs text-sky-800">
                {billingSettings?.payment_automation_enabled
                  ? 'O Pix dinâmico está ativo. Cada QR Code é vinculado à mensalidade e a baixa só ocorre após conferência direta no Mercado Pago.'
                  : 'A conta está isolada e o Pix manual continua sendo o padrão até você ativar a conciliação automática.'}
              </p>

              {!mercadoPagoWebhookConfigured && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  A assinatura do webhook ainda precisa ser configurada e validada
                  antes de liberar o Pix dinâmico.
                </p>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void connectMercadoPago()}
                  disabled={!mercadoPagoConfigured || connectingMercadoPago}
                  className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connectingMercadoPago
                    ? 'Redirecionando...'
                    : mercadoPagoConnection?.status === 'connected'
                      ? 'Reconectar Mercado Pago'
                      : 'Conectar Mercado Pago'}
                </button>

                <button
                  type="button"
                  onClick={() => void disconnectMercadoPago()}
                  disabled={
                    !mercadoPagoConnection ||
                    mercadoPagoConnection.status === 'disabled' ||
                    disconnectingMercadoPago
                  }
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {disconnectingMercadoPago ? 'Desconectando...' : 'Desconectar'}
                </button>
              </div>

              {mercadoPagoConnection?.status === 'connected' && (
                <button
                  type="button"
                  onClick={() =>
                    void updatePaymentAutomation(
                      !billingSettings?.payment_automation_enabled
                    )
                  }
                  disabled={
                    savingPaymentAutomation ||
                    (!billingSettings?.payment_automation_enabled &&
                      !mercadoPagoWebhookConfigured)
                  }
                  className={`w-full rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                    billingSettings?.payment_automation_enabled
                      ? 'border border-amber-200 text-amber-800'
                      : 'bg-emerald-600 text-white'
                  }`}
                >
                  {savingPaymentAutomation
                    ? 'Salvando...'
                    : billingSettings?.payment_automation_enabled
                      ? 'Voltar para Pix manual'
                      : 'Ativar Pix dinâmico'}
                </button>
              )}

              <p className="text-xs text-gray-500">
                Para revogar também a autorização no Mercado Pago, o titular
                deve removê-la nas configurações da própria conta.
              </p>
            </section>

          </div>

          <aside className="space-y-4">
            <section className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold">Usuario</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">Email</dt>
                  <dd className="font-medium">{tenantUser?.email ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Perfil</dt>
                  <dd className="font-medium">{tenantUser?.role ?? '-'}</dd>
                </div>
              </dl>
            </section>

            <form onSubmit={changePassword} className="bg-white rounded-2xl shadow p-5 space-y-4">
              <h2 className="font-bold">Alterar senha</h2>

              <label className="block text-sm font-medium">
                Senha atual
                <input
                  value={passwordForm.current_password}
                  onChange={(event) => setPasswordForm({
                    ...passwordForm,
                    current_password: event.target.value,
                  })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="password"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Nova senha
                <input
                  value={passwordForm.new_password}
                  onChange={(event) => setPasswordForm({
                    ...passwordForm,
                    new_password: event.target.value,
                  })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="password"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Confirmar senha
                <input
                  value={passwordForm.confirm_password}
                  onChange={(event) => setPasswordForm({
                    ...passwordForm,
                    confirm_password: event.target.value,
                  })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="password"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={savingPassword}
                className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
              >
                {savingPassword ? 'Salvando...' : 'Alterar senha'}
              </button>
            </form>

            <button
              onClick={logout}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 font-medium"
            >
              Sair
            </button>
          </aside>
        </section>
      </div>
    </main>
  )
}
