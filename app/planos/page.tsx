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
  {
    title: string;
    eyebrow: string;
    badge: string;
    headline: string;
    pitch: string;
    idealFor: string;
    features: string[];
    note?: string;
    shellClass: string;
    badgeClass: string;
    eyebrowClass: string;
    priceClass: string;
    buttonClass: string;
    checkClass: string;
  }
> = {
  plan1: {
    title: "Plano 1",
    eyebrow: "Cobranças inteligentes",
    badge: "Essencial para começar",
    headline: "Receba em dia sem transformar cobrança em constrangimento.",
    pitch:
      "O João organiza clientes, mensalidades e lembretes para você ganhar previsibilidade e preservar um atendimento cordial.",
    idealFor: "Professores, autônomos e pequenos negócios recorrentes",
    features: [
      "Cadastro e controle de clientes ou alunos",
      "Mensalidades e histórico financeiro",
      "Lembretes de cobrança pelo WhatsApp",
    ],
    shellClass:
      "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50",
    badgeClass: "bg-emerald-600 text-white",
    eyebrowClass: "text-emerald-700",
    priceClass: "text-emerald-700",
    buttonClass: "bg-emerald-700 hover:bg-emerald-800",
    checkClass: "text-emerald-600",
  },
  plan2: {
    title: "Plano 2",
    eyebrow: "Agenda que trabalha por você",
    badge: "Mais tempo para atender",
    headline: "Sua agenda continua funcionando até quando você está ocupado.",
    pitch:
      "Transforme o WhatsApp em uma recepção disponível para organizar serviços, profissionais, confirmações e lembretes.",
    idealFor: "Salões, clínicas, consultórios e prestadores de serviço",
    features: [
      "Agenda de serviços e profissionais",
      "Agendamento pelo WhatsApp",
      "Confirmações e lembretes automáticos",
    ],
    note: "Inclui 1 profissional. Cada profissional adicional custa R$ 25,00/mês, após aprovação.",
    shellClass:
      "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50",
    badgeClass: "bg-violet-600 text-white",
    eyebrowClass: "text-violet-700",
    priceClass: "text-violet-700",
    buttonClass: "bg-violet-700 hover:bg-violet-800",
    checkClass: "text-violet-600",
  },
  plan3: {
    title: "Plano 3",
    eyebrow: "Cobranças + agenda",
    badge: "O mais versátil",
    headline: "Alunos, mensalidades e agenda finalmente no mesmo ritmo.",
    pitch:
      "Una a jornada do aluno ao controle financeiro e aos agendamentos em uma operação que cresce sem perder a proximidade.",
    idealFor: "Academias, estúdios, escolas esportivas e arenas",
    features: [
      "Tudo para controlar alunos e mensalidades",
      "Agenda de serviços e profissionais",
      "Atendimento e lembretes pelo WhatsApp",
    ],
    note: "Cada profissional adicional custa R$ 50,00/mês, após aprovação.",
    shellClass:
      "border-sky-300 bg-gradient-to-br from-sky-50 via-white to-cyan-50 shadow-[0_22px_65px_rgba(14,116,144,0.14)]",
    badgeClass: "bg-sky-600 text-white",
    eyebrowClass: "text-sky-700",
    priceClass: "text-sky-700",
    buttonClass: "bg-sky-700 hover:bg-sky-800",
    checkClass: "text-sky-600",
  },
  plan4: {
    title: "Plano 4",
    eyebrow: "Cardápio + pedidos + estoque",
    badge: "Feito para vender mais",
    headline: "Seu restaurante mais ágil, do primeiro pedido ao estoque.",
    pitch:
      "O João apresenta o cardápio, recebe pedidos pelo WhatsApp e ajuda sua equipe a manter produtos, vendas e operação em perfeita sintonia.",
    idealFor:
      "Restaurantes, lanchonetes, bares, cafeterias e alimentação em espaços esportivos",
    features: [
      "Cardápio completo direto no WhatsApp",
      "Pedidos organizados e estoque sob controle",
      "Visão financeira da operação em um só lugar",
    ],
    shellClass:
      "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50",
    badgeClass: "bg-amber-600 text-white",
    eyebrowClass: "text-amber-700",
    priceClass: "text-amber-700",
    buttonClass: "bg-amber-700 hover:bg-amber-800",
    checkClass: "text-amber-600",
  },
  plan5: {
    title: "Plano 5",
    eyebrow: "Pedidos + reservas + operação",
    badge: "Experiência completa",
    headline: "Prepare sua operação para receber mais pedidos e mais reservas.",
    pitch:
      "Conecte cardápio, pedidos, estoque e reservas para atender com agilidade em restaurantes e ambientes esportivos que unem consumo e experiências.",
    idealFor:
      "Restaurantes com reservas, clubes, arenas e complexos esportivos",
    features: [
      "Tudo do Plano 4, totalmente integrado",
      "Reservas organizadas junto à operação",
      "Pedidos, estoque e financeiro trabalhando juntos",
    ],
    shellClass:
      "border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50",
    badgeClass: "bg-indigo-700 text-white",
    eyebrowClass: "text-indigo-700",
    priceClass: "text-indigo-700",
    buttonClass: "bg-indigo-800 hover:bg-indigo-900",
    checkClass: "text-indigo-600",
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
          <div>
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <p className="text-sm font-black uppercase tracking-[0.14em] text-[#0d65bd]">
                Encontre o seu ponto de partida
              </p>
              <h2 className="mt-3 text-3xl font-black sm:text-4xl">
                Um plano forte para cada desafio do seu negócio.
              </h2>
              <p className="mt-4 leading-7 text-slate-600">
                Compare pelo resultado que você quer alcançar. Quando sua operação
                evoluir, o Assistente João evolui com ela.
              </p>
            </div>

            <div className="space-y-8">
              {visiblePlans.map((plan, index) => {
                const presentation = planPresentation[plan.code];

                return (
                  <article
                    className={`relative overflow-hidden rounded-3xl border p-6 shadow-sm sm:p-8 lg:p-10 ${presentation.shellClass}`}
                    key={plan.code}
                  >
                  <div
                    aria-hidden="true"
                    className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-white/70 blur-3xl"
                  />
                  <div className="relative grid gap-8 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
                    <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                      <span
                        className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] ${presentation.badgeClass}`}
                      >
                        {presentation.badge}
                      </span>
                      <p
                        className={`mt-6 text-xs font-black uppercase tracking-[0.16em] ${presentation.eyebrowClass}`}
                      >
                        {presentation.title} · {presentation.eyebrow}
                      </p>
                      <h3 className="mt-3 max-w-2xl text-3xl font-black leading-tight text-[#07111f] sm:text-4xl">
                        {presentation.headline}
                      </h3>
                      <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                        {presentation.pitch}
                      </p>
                      <div className="mt-6 inline-flex rounded-xl border border-white/80 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur">
                        Ideal para: {presentation.idealFor}
                      </div>
                    </div>

                    <div
                      className={`rounded-2xl border border-white/80 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.10)] backdrop-blur sm:p-7 ${
                        index % 2 === 1 ? "lg:order-1" : ""
                      }`}
                    >
                      <p className="text-sm font-bold text-slate-500">Tudo isso por</p>
                      <p className={`mt-1 text-4xl font-black ${presentation.priceClass}`}>
                        {formatCurrency(plan.monthly_amount_cents)}
                        <span className="text-sm font-semibold text-slate-500"> /mês</span>
                      </p>
                      <ul className="mt-6 space-y-3 text-sm leading-6 text-slate-600">
                        {presentation.features.map((feature) => (
                          <li className="flex gap-3" key={feature}>
                            <span className={`font-black ${presentation.checkClass}`}>✓</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      {presentation.note && (
                        <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                          {presentation.note}
                        </p>
                      )}
                      <Link
                        className={`mt-7 block rounded-xl px-5 py-3.5 text-center text-sm font-black text-white shadow-sm transition-colors ${presentation.buttonClass}`}
                        href="/cadastro"
                      >
                        Quero o {presentation.title}
                      </Link>
                    </div>
                  </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {plan3 && (
        <section className="px-6 pb-14 sm:px-8 lg:px-10">
          <div className="relative mx-auto grid w-full max-w-6xl gap-8 overflow-hidden rounded-3xl border border-[#69d4ef] bg-gradient-to-br from-[#03142f] via-[#073a86] to-[#0d65bd] px-6 py-10 text-white shadow-[0_24px_70px_rgba(3,20,47,0.24)] sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10">
            <div aria-hidden="true" className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl" />
            <div className="relative">
              <span className="inline-flex rounded-full bg-[#68e5ff] px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-[#03142f]">
                O Plano 3 em outro nível
              </span>
              <p className="mt-6 text-sm font-black uppercase tracking-[0.14em] text-[#68e5ff]">
                Extensão para o Plano 3
              </p>
              <h2 className="mt-3 text-3xl font-black sm:text-4xl">
                Transforme cada ambiente em uma oportunidade de reserva.
              </h2>
              <p className="mt-4 text-base leading-7 text-white/80 sm:text-lg">
                O Plano 3 Plus coloca quadras, salões de festa, piscinas e outros
                espaços no fluxo do João: horários organizados, duração flexível,
                proteção contra conflitos e acompanhamento direto no painel.
              </p>
              <p className="mt-6 font-bold text-[#b9f4ff]">
                Feito para academias, arenas e negócios que faturam com seus espaços.
              </p>
            </div>

            <article className="relative rounded-2xl border border-white/20 bg-white p-6 text-slate-600 shadow-[0_18px_50px_rgba(0,0,0,0.18)] sm:p-7">
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
                className="mt-6 block rounded-xl bg-[#0d65bd] px-5 py-3.5 text-center text-sm font-black text-white shadow-sm transition-colors hover:bg-[#084e92]"
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
