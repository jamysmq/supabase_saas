import Link from "next/link";

const plans = [
  {
    title: "Cobranças e alunos",
    description: "Para professores, escolas pequenas e serviços com mensalidade recorrente.",
  },
  {
    title: "Agenda",
    description: "Para salões, clínicas e profissionais que precisam organizar horários.",
  },
  {
    title: "Restaurante",
    description: "Para cardápio, pedidos e atendimento pelo WhatsApp.",
  },
];

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#dff4ff_0%,#f7fbff_52%,#eef8ff_100%)] text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link className="text-sm font-bold uppercase tracking-[0.14em] text-sky-900" href="/">
            Assistente Jack
          </Link>
          <Link
            className="rounded-md border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 shadow-sm hover:bg-sky-50"
            href="https://app.meuassistentevirtual.com.br/login"
          >
            Entrar
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-8 py-12 lg:grid-cols-[1.05fr_0.95fr]">
          <section>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-sky-700">
              Comece pelo WhatsApp
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
              Se cadastre para usar o Assistente Jack no seu negócio.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              Conte um pouco da sua rotina e a gente prepara o melhor plano para
              cobranças, agenda, pedidos ou atendimento humano pelo painel.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                className="rounded-md bg-sky-700 px-5 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-sky-800"
                href="mailto:contato@meuassistentevirtual.com.br?subject=Quero%20me%20cadastrar%20no%20Assistente%20Jack&body=Ol%C3%A1%2C%20quero%20me%20cadastrar%20no%20Assistente%20Jack.%0A%0ANome%3A%0ANeg%C3%B3cio%3A%0AWhatsApp%3A%0APlano%20ou%20necessidade%3A"
              >
                Solicitar cadastro
              </a>
              <Link
                className="rounded-md border border-sky-200 bg-white px-5 py-3 text-center text-sm font-bold text-sky-800 hover:bg-sky-50"
                href="/"
              >
                Página inicial
              </Link>
            </div>
          </section>

          <section className="space-y-3">
            {plans.map((plan) => (
              <article
                className="rounded-lg border border-sky-100 bg-white p-5 shadow"
                key={plan.title}
              >
                <h2 className="font-bold text-slate-950">{plan.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {plan.description}
                </p>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
