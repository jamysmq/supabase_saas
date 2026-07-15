'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
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
  timezone: string | null
  max_customer_groups: number | null
}

type TenantUser = {
  tenant_id: string
  role: string
  email: string
  must_change_password: boolean
}

export default function SettingsPage() {
  const router = useRouter()

  const [tenantUser, setTenantUser] = useState<TenantUser | null>(null)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
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

    const [tenantResult, settingsResult] = await Promise.all([
      supabase
        .from('tenants')
        .select('id, legal_name, public_name, email, whatsapp_e164, plan, status')
        .eq('id', result.tenantUser.tenant_id)
        .single(),
      supabase
        .from('tenant_billing_settings')
        .select('pix_key, pix_key_type, pix_beneficiary_name, timezone, max_customer_groups')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .maybeSingle(),
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
    setPixForm({
      pix_key: settingsResult.data?.pix_key ?? '',
      pix_key_type: settingsResult.data?.pix_key_type ?? 'cpf',
      pix_beneficiary_name: settingsResult.data?.pix_beneficiary_name ?? '',
    })
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
                <h2 className="font-bold">Pix de recebimento</h2>
                <p className="text-sm text-gray-500">
                  Estes dados podem aparecer nas mensagens de cobrança dos seus {labels.customerPluralLower}.
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
                    <option value="email">Email</option>
                    <option value="phone">Telefone</option>
                    <option value="random">Aleatoria</option>
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

              <button
                type="submit"
                disabled={savingPix}
                className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
              >
                {savingPix ? 'Salvando...' : 'Salvar Pix'}
              </button>
            </form>

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
