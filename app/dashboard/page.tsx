'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels, getCatalogLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'
import {
  tenantCanUseAppointments,
  tenantCanUseBilling,
  tenantCanUseCatalog,
  tenantCanUseInventory,
  tenantCanUseOperationalFinance,
} from '../../src/lib/plan-features'

type TenantUser = {
  tenant_id: string
  role: string
  email: string
  must_change_password: boolean
}

export default function DashboardPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [tenantPlan, setTenantPlan] = useState<string | null>(null)
  const [resourceBookingPlusEnabled, setResourceBookingPlusEnabled] = useState(false)
  const [tenantUser, setTenantUser] =
    useState<TenantUser | null>(null)

  const labels = getBusinessLabels(businessType)
  const catalog = getCatalogLabels(businessType)
  const canUseBilling = tenantCanUseBilling(tenantPlan)
  const canUseAppointments = tenantCanUseAppointments(tenantPlan)
  const canUseCatalog = tenantCanUseCatalog(tenantPlan)
  const canUseInventory = tenantCanUseInventory(tenantPlan, businessType)
  const canUseFinance = canUseBilling || canUseCatalog || tenantCanUseOperationalFinance(tenantPlan)

  const navigationItems = [
    ...(canUseBilling
      ? [{
          href: '/pending-signups',
          title: 'Cadastros pendentes',
          description: 'Revise os alunos que solicitaram cadastro pelo WhatsApp.',
          teacherOnly: true,
        },
        {
          href: '/pending-payments',
          title: 'Pagamentos pendentes',
          description: 'Confirme mensalidades recebidas e acompanhe cobranças.',
        },
        {
          href: '/students',
          title: `Gerenciamento dos ${labels.customerPluralLower}`,
          description: `Gerencie ${labels.customerPluralLower} ativos e inativos, ${labels.groupPluralLower}, planos e mensalidades em um só lugar.`,
        }]
      : []),
    ...(canUseAppointments
      ? [{
          href: '/appointments',
          title: 'Agenda',
          description: 'Gerencie atendimentos, consultas e horários.',
        },
        {
          href: '/appointment-history?from=dashboard',
          title: 'Histórico de agendamentos',
          description: 'Consulte atendimentos realizados, cancelados e excluídos.',
        },
        ...(resourceBookingPlusEnabled ? [{
          href: '/appointment-resources?from=dashboard',
          title: 'Ambientes',
          description: 'Locais para aluguel, como quadras, salões de festa, piscinas e outros espaços.',
        }] : [])]
      : []),
    ...(canUseInventory
      ? [{
          href: '/inventory',
          title: 'Estoque',
          description: 'Controle entradas, saídas, saldos e custos dos produtos.',
        }]
      : []),
    ...(canUseCatalog
      ? [{
          href: '/catalogo',
          title: catalog.title,
          description: catalog.dashboardCatalogDescription,
        },
        {
          href: '/pedidos',
          title: 'Pedidos pendentes',
          description: catalog.dashboardOrdersDescription,
        }]
      : []),
    ...(canUseFinance
      ? [{
          href: '/financeiro',
          title: 'Financeiro',
          description: 'Receitas, despesas e saldo do período, com resumo por dia e exportação.',
        }]
      : []),
    {
      href: '/whatsapp-inbox',
      title: 'Atendimento WhatsApp',
      description: 'Responda clientes que pediram ajuda humana pelo WhatsApp.',
    },
    {
      href: '/settings',
      title: 'Configurações da conta',
      description: 'Atualize Pix, dados da conta e senha de acesso.',
    },
  ]

  useEffect(() => {
    async function load() {
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
      setTenantPlan(result.tenant?.plan ?? null)
      setResourceBookingPlusEnabled(result.tenant?.resource_booking_plus_enabled === true)
      setLoading(false)
    }

    load()
  }, [router])

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.assign('https://www.meuassistentevirtual.com.br/')
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sky-50 text-slate-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#dff4ff_0%,#f4fbff_42%,#eef8ff_100%)] px-4 py-6 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-lg border border-sky-100 bg-white p-5 shadow">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Painel do seu negócio
              </p>

              <h1 className="mt-1 text-2xl font-bold text-slate-950">
                Dashboard
              </h1>

              <p className="mt-1 text-sm text-slate-600">
                {tenantUser?.email}
              </p>

              <p className="mt-2 break-all text-xs text-slate-500">
                Código do negócio: {tenantUser?.tenant_id}
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="h-10 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800"
            >
              Sair
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {navigationItems
            .filter((item) => !('teacherOnly' in item) || businessType === 'teacher')
            .map((item) => (
            <Link
              key={item.href}
              className="group block rounded-lg border border-sky-100 bg-white p-5 text-slate-950 shadow hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-200"
              href={item.href}
            >
              <div className="flex items-start gap-3">
                <span className="mt-[0.35rem] h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.14)]" />
                <div>
                  <div className="font-bold text-slate-950 group-hover:text-sky-900">{item.title}</div>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    {item.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
