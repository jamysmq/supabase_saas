"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PublicHeader } from "../public-header";

type Plan = {
  code: string;
  name: string;
  description: string | null;
  monthly_amount_cents: number;
};

const planPresentation: Record<
  string,
  { title: string; eyebrow: string; features: string[]; note?: string }
> = {
  plan1: {
    title: "Plano 1",
    eyebrow: "Cobranças",
    features: [
      "Cadastro e controle de clientes ou alunos",
      "Mensalidades e histórico financeiro",
      "Lembretes de cobrança pelo WhatsApp",
    ],
  },
  plan2: {
    title: "Plano 2",
    eyebrow: "Agenda",
    features: [
      "Agenda de serviços e profissionais",
      "Agendamento pelo WhatsApp",
      "Confirmações e lembretes automáticos",
    ],
    note: "Inclui 1 profissional. Cada profissional adicional custa R$ 25,00/mês, após aprovação.",
  },
  plan3: {
    title: "Plano 3",
    eyebrow: "Cobranças + agenda",
    features: [
      "Tudo para controlar alunos e mensalidades",
      "Agenda de serviços e profissionais",
      "Atendimento e lembretes pelo WhatsApp",
    ],
    note: "Cada profissional adicional custa R$ 50,00/mês, após aprovação.",
  },
  plan4: {
    title: "Plano 4",
    eyebrow: "Catálogo + pedidos + estoque",
    features: [
      "Catálogo ou cardápio no WhatsApp",
      "Pedidos e controle de estoque",
      "Financeiro operacional organizado",
    ],
  },
  plan5: {
    title: "Plano 5",
    eyebrow: "Operação completa",
    features: [
      "Tudo do Plano 4",
      "Agenda de reservas e atendimentos",
      "Pedidos, estoque e financeiro integrados",
    ],
  },
};

function formatCurrency(valueInCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valueInCents / 100);
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    async function loadPlans() {
      try {
        const response = await fetch("/api/public/plans", { cache: "no-store" });
        const data = response.ok ? await response.json() : { plans: [] };
        setPlans(data.plans ?? []);
        setLoadError(!response.ok || !data.plans?.length);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }

    void loadPlans();
  }, []);

  const visiblePlans = useMemo(
    () => plans.filter((plan) => planPresentation[plan.code]),
    [plans]
  );
  const plan3 = visiblePlans.find((plan) => plan.code === "plan3");
  const plusAmountCents = 7990;

  return (
    <main className="min-h-screen bg-[#f7fbff] text-[#07111f]">
      <section className="bg-[#03142f] text-white">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 sm:px-8 lg:px-10">
          <PublicHeader />

          <div className="mx-auto max-w-3xl py-16 text-center sm:py-20">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#68e5ff]">
              Planos do Assistente João
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
              Escolha o plano que acompanha o momento do seu negócio.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/80 sm:text-lg">
              Comece com o que você precisa agora e evolua conforme sua operação
              crescer. Todos os planos incluem atendimento organizado pelo
              WhatsApp e acesso ao painel.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-14 sm:px-8 lg:px-10">
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white p-8 text-center text-slate-600 shadow-sm">
            Carregando os planos disponíveis...
          </div>
        )}

        {loadError && !loading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
            Não foi possível carregar os valores agora. Fale com a nossa equipe
            para consultar os planos disponíveis.
          </div>
        )}

        {!loading && visiblePlans.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visiblePlans.map((plan) => {
              const presentation = planPresentation[plan.code];
              const highlighted = plan.code === "plan3";

              return (
                <article
                  className={`relative flex flex-col rounded-xl border bg-white p-6 shadow-sm ${
                    highlighted
                      ? "border-[#38bde8] shadow-[0_16px_45px_rgba(14,116,144,0.14)]"
                      : "border-[#d7e6f5]"
                  }`}
                  key={plan.code}
                >
                  {highlighted && (
                    <span className="absolute right-5 top-5 rounded-full bg-[#e1f8ff] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#075d91]">
                      Mais versátil
                    </span>
                  )}
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#0d65bd]">
                    {presentation.eyebrow}
                  </p>
                  <h2 className="mt-2 text-2xl font-black text-[#07111f]">
                    {presentation.title}
                  </h2>
                  <p className="mt-5 text-3xl font-black text-[#073a86]">
                    {formatCurrency(plan.monthly_amount_cents)}
                    <span className="text-sm font-semibold text-slate-500"> /mês</span>
                  </p>
                  <ul className="mt-6 flex-1 space-y-3 text-sm leading-6 text-slate-600">
                    {presentation.features.map((feature) => (
                      <li className="flex gap-3" key={feature}>
                        <span className="font-black text-emerald-500">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {presentation.note && (
                    <p className="mt-5 rounded-md bg-sky-50 p-3 text-xs leading-5 text-sky-900">
                      {presentation.note}
                    </p>
                  )}
                  <Link
                    className="mt-7 rounded-md bg-[#073a86] px-5 py-3 text-center text-sm font-bold text-white hover:bg-[#052a61]"
                    href="/cadastro"
                  >
                    Escolher este plano
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {plan3 && (
        <section className="bg-[#eafaff]">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-10">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-[#0d65bd]">
                Extensão para o Plano 3
              </p>
              <h2 className="mt-3 text-3xl font-black text-[#07111f]">
                Plano 3 Plus: quadras e ambientes
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Ideal para academias, arenas e negócios de locação. Cadastre
                quadras, salões de festa, piscinas e outros espaços, defina
                horários e duração, evite conflitos e acompanhe os agendamentos
                no painel.
              </p>
            </div>

            <article className="rounded-xl border border-[#8fd8ee] bg-white p-6 shadow-sm">
              <div className="space-y-3 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-4">
                  <span>Plano 3</span>
                  <strong className="text-slate-900">
                    {formatCurrency(plan3.monthly_amount_cents)}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Extensão Ambientes</span>
                  <strong className="text-slate-900">+ {formatCurrency(plusAmountCents)}</strong>
                </div>
                <div className="border-t border-sky-100 pt-4">
                  <div className="flex items-end justify-between gap-4">
                    <span className="font-bold text-slate-900">Plano 3 Plus</span>
                    <strong className="text-2xl text-[#073a86]">
                      {formatCurrency(plan3.monthly_amount_cents + plusAmountCents)}
                      <span className="text-sm text-slate-500">/mês</span>
                    </strong>
                  </div>
                </div>
              </div>
              <Link
                className="mt-6 block rounded-md bg-[#0d65bd] px-5 py-3 text-center text-sm font-bold text-white hover:bg-[#084e92]"
                href="/cadastro"
              >
                Quero o Plano 3 Plus
              </Link>
            </article>
          </div>
        </section>
      )}

      <section className="bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0d65bd]">
              Ainda está em dúvida?
            </p>
            <h2 className="mt-3 text-3xl font-black">
              A gente ajuda você a escolher sem complicação.
            </h2>
          </div>
          <Link
            className="w-full rounded-md bg-[#68e5ff] px-5 py-3 text-center text-sm font-bold text-[#03142f] shadow-sm hover:bg-[#b9f4ff] sm:w-auto"
            href="/#falar-conosco"
          >
            Falar com a nossa equipe
          </Link>
        </div>
      </section>
    </main>
  );
}
