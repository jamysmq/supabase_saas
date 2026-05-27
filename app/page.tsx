import Link from "next/link";
import Image from "next/image";

const benefits = [
  ["Atendimento no WhatsApp", "Conversas organizadas para você responder sem se perder."],
  ["Cobranças em dia", "Mensalidades, pendências e confirmações acompanhadas no painel."],
  ["Agenda e pedidos", "Horários, cardápios e pedidos em uma rotina mais simples."],
];

const steps = [
  "O cliente chama no WhatsApp.",
  "Jack ajuda a organizar a conversa.",
  "Você acompanha tudo pelo painel.",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7fbff] text-[#07111f]">
      <section className="relative isolate min-h-[92vh] overflow-hidden bg-[#03142f] text-white">
        <Image
          src="/jack-hero.svg"
          alt="Assistente Jack sorrindo"
          fill
          priority
          sizes="100vw"
          className="absolute inset-y-0 right-0 -z-10 h-full w-full object-cover object-[62%_center] opacity-95"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(3,20,47,0.98)_0%,rgba(3,20,47,0.9)_38%,rgba(3,20,47,0.38)_74%,rgba(3,20,47,0.08)_100%)]" />

        <div className="mx-auto flex min-h-[92vh] w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
          <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link className="text-sm font-bold uppercase tracking-[0.14em]" href="/">
              Assistente Jack
            </Link>
            <nav className="grid w-full grid-cols-2 gap-2 text-sm text-white/82 sm:flex sm:w-auto sm:items-center sm:gap-5">
              <Link className="self-center hover:text-white" href="/privacidade">
                Privacidade
              </Link>
              <Link className="self-center text-right hover:text-white sm:text-left" href="/termos">
                Termos
              </Link>
              <Link
                className="rounded-md border border-white/35 px-3 py-2 text-center font-semibold text-white hover:border-white hover:bg-white/10 sm:px-4"
                href="/cadastro"
              >
                Se cadastre!
              </Link>
              <Link
                className="rounded-md bg-white px-3 py-2 text-center font-semibold text-[#073a86] shadow-sm hover:bg-[#dff7ff] sm:px-4"
                href="https://app.meuassistentevirtual.com.br/login"
              >
                Entrar
              </Link>
            </nav>
          </header>

          <div className="flex flex-1 items-center py-14">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-[#68e5ff]">
                Jack, o assistente virtual
              </p>
              <h1 className="text-5xl font-black leading-[1.02] text-white sm:text-6xl lg:text-7xl">
                Assistente Jack
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/84 sm:text-xl">
                Um ajudante digital para pequenos negócios atenderem melhor,
                lembrarem cobranças, organizarem horários e acompanharem pedidos
                sem perder conversa pelo caminho.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="rounded-md bg-[#68e5ff] px-5 py-3 text-center text-sm font-bold text-[#03142f] shadow-lg shadow-cyan-950/30 hover:bg-white"
                  href="https://app.meuassistentevirtual.com.br/login"
                >
                  Acessar painel
                </Link>
                <a
                  className="rounded-md border border-white/30 px-5 py-3 text-center text-sm font-bold text-white hover:border-white hover:bg-white/10"
                  href="mailto:contato@meuassistentevirtual.com.br"
                >
                  Falar conosco
                </a>
              </div>

              <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
                {steps.map((step, index) => (
                  <div className="border-l border-white/20 pl-4" key={step}>
                    <div className="text-2xl font-black text-[#68e5ff]">
                      {index + 1}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/78">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-6 py-12 sm:px-8 md:grid-cols-3 lg:px-10">
          {benefits.map(([title, description]) => (
            <article
              className="rounded-md border border-[#d7e6f5] bg-[#f8fbff] p-5 shadow-sm"
              key={title}
            >
              <h2 className="text-lg font-bold text-[#073a86]">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#44546a]">
                {description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#eef8ff]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0d65bd]">
              Feito para rotina real
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-black text-[#07111f]">
              Menos bagunça nas mensagens. Mais clareza no atendimento.
            </h2>
          </div>
          <Link
            className="w-full rounded-md bg-[#073a86] px-5 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-[#052a61] sm:w-auto"
            href="https://app.meuassistentevirtual.com.br/login"
          >
            Entrar no painel
          </Link>
        </div>
      </section>
    </main>
  );
}
