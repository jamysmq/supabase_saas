import Link from "next/link";
import Image from "next/image";
import { ContactCard } from "./contact-card";

const benefits = [
  [
    "Atendimento sem bagunça",
    "As conversas do WhatsApp chegam organizadas no seu painel. Você responde rápido e não perde nenhum cliente no meio das mensagens.",
  ],
  [
    "Cobranças em dia",
    "Mensalidades, lembretes e confirmações de pagamento acontecem no automático. Menos cobrança manual, menos inadimplência esquecida.",
  ],
  [
    "Agenda e pedidos no controle",
    "Horários, cardápios e pedidos ficam num só lugar. O cliente agenda ou pede pelo WhatsApp e você acompanha tudo de um jeito simples.",
  ],
];

const steps = [
  "O cliente chama no seu WhatsApp.",
  "O Jack organiza a conversa e adianta o atendimento.",
  "Você acompanha e fecha tudo pelo painel.",
];

const segments = [
  [
    "Professores e escolas",
    "Controle de alunos, turmas e mensalidades com lembrete de cobrança automático.",
  ],
  [
    "Salões e clínicas",
    "Agenda de horários por profissional, confirmação e lembrete de atendimento pelo WhatsApp.",
  ],
  [
    "Restaurantes",
    "Cardápio digital, pedidos e financeiro organizados, com atendimento pelo WhatsApp.",
  ],
  [
    "Autônomos",
    "Clientes, cobranças e agenda no mesmo lugar, sem planilha e sem caderninho.",
  ],
];

// Mockup ilustrativo da conversa — demonstra o produto sem depender de dado real.
const chat = [
  { from: "client", text: "Oi! Queria marcar um horário pra quinta 😊" },
  { from: "jack", text: "Claro! Tenho quinta às 14h ou 16h30. Qual fica melhor?" },
  { from: "client", text: "16h30 👍" },
  { from: "jack", text: "Agendado! Te mando um lembrete um dia antes. Até quinta 🙌" },
];

export default function Home() {
  const contactPhone = (process.env.WHATSAPP_PUBLIC_PHONE_E164 ?? "").replace(/\D/g, "");
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(
        "Olá! Quero saber mais sobre o Assistente Jack."
      )}`
    : "#falar-conosco";

  return (
    <main className="min-h-screen bg-[#f7fbff] text-[#07111f]">
      <section className="relative isolate min-h-[86vh] overflow-hidden bg-[#03142f] text-white">
        <Image
          src="/jack-hero.svg"
          alt="Assistente Jack sorrindo"
          fill
          priority
          sizes="100vw"
          className="absolute inset-y-0 right-0 -z-10 h-full w-full object-cover object-[62%_center] opacity-95"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(3,20,47,0.98)_0%,rgba(3,20,47,0.9)_38%,rgba(3,20,47,0.38)_74%,rgba(3,20,47,0.08)_100%)]" />

        <div className="mx-auto flex min-h-[86vh] w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
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
                className="self-center hover:text-white"
                href="https://app.meuassistentevirtual.com.br/login"
              >
                Entrar
              </Link>
              <Link
                className="rounded-md bg-[#68e5ff] px-3 py-2 text-center font-bold text-[#03142f] shadow-sm hover:bg-white sm:px-4"
                href="/cadastro"
              >
                Cadastre-se
              </Link>
            </nav>
          </header>

          <div className="flex flex-1 items-center py-10">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-[#68e5ff]">
                Assistente virtual para pequenos negócios
              </p>
              <h1 className="text-5xl font-black leading-[1.03] text-white sm:text-6xl lg:text-7xl">
                Atenda, cobre e agende pelo WhatsApp sem perder cliente.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/84 sm:text-xl">
                O Jack é o assistente virtual que organiza o WhatsApp do seu
                negócio: responde clientes, lembra mensalidades e cuida da agenda
                e dos pedidos — tudo acompanhado de um painel só seu.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="rounded-md bg-[#68e5ff] px-5 py-3 text-center text-sm font-bold text-[#03142f] shadow-lg shadow-cyan-950/30 hover:bg-white"
                  href="/cadastro"
                >
                  Começar agora
                </Link>
                <a
                  className="rounded-md border border-white/30 px-5 py-3 text-center text-sm font-bold text-white hover:border-white hover:bg-white/10"
                  href="#falar-conosco"
                >
                  Falar com a gente
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
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-6 py-14 sm:px-8 md:grid-cols-3 lg:px-10">
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

      <section className="bg-[#03142f] text-white">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-16 sm:px-8 lg:grid-cols-2 lg:px-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#68e5ff]">
              Veja como fica na prática
            </p>
            <h2 className="mt-3 max-w-lg text-3xl font-black leading-tight sm:text-4xl">
              O cliente conversa pelo WhatsApp. Você só acompanha o resultado.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/80">
              O Jack adianta o atendimento, marca horário, registra pedido ou
              lembra a mensalidade — e cada conversa fica salva e organizada no
              seu painel para você assumir quando quiser.
            </p>
            <Link
              className="mt-8 inline-block rounded-md bg-[#68e5ff] px-5 py-3 text-sm font-bold text-[#03142f] shadow-lg shadow-cyan-950/30 hover:bg-white"
              href="/cadastro"
            >
              Quero começar
            </Link>
          </div>

          <div className="mx-auto w-full max-w-sm rounded-3xl border border-white/15 bg-[#0b2444] p-4 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#68e5ff] text-base font-black text-[#03142f]">
                J
              </div>
              <div>
                <p className="text-sm font-bold text-white">Assistente Jack</p>
                <p className="text-xs text-[#68e5ff]">online agora</p>
              </div>
            </div>
            <div className="space-y-2 py-4">
              {chat.map((message, index) => (
                <div
                  className={
                    message.from === "client"
                      ? "flex justify-end"
                      : "flex justify-start"
                  }
                  key={index}
                >
                  <p
                    className={
                      message.from === "client"
                        ? "max-w-[80%] rounded-2xl rounded-br-sm bg-[#68e5ff] px-3 py-2 text-sm leading-5 text-[#03142f]"
                        : "max-w-[80%] rounded-2xl rounded-bl-sm bg-white/12 px-3 py-2 text-sm leading-5 text-white"
                    }
                  >
                    {message.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8 lg:px-10">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0d65bd]">
            Feito para o seu negócio
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-black text-[#07111f]">
            Seja qual for o seu negócio, o Jack se adapta à sua rotina.
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {segments.map(([title, description]) => (
              <article
                className="rounded-md border border-[#d7e6f5] bg-[#f8fbff] p-5 shadow-sm"
                key={title}
              >
                <h3 className="text-base font-bold text-[#073a86]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#44546a]">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ContactCard />

      <section className="bg-[#eef8ff]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0d65bd]">
              Pronto para organizar seu atendimento?
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-black text-[#07111f]">
              Menos bagunça nas mensagens. Mais clareza no seu dia.
            </h2>
          </div>
          <Link
            className="w-full rounded-md bg-[#073a86] px-5 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-[#052a61] sm:w-auto"
            href="/cadastro"
          >
            Criar minha conta
          </Link>
        </div>
      </section>

      <footer className="bg-[#03142f] text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 text-xs leading-6 text-white/70 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <p>
            © 2026 Soft Ink. Assistente Jack é um produto da Soft Ink.
            meuassistentevirtual.com.br é o domínio oficial.
          </p>
          <div className="flex flex-wrap gap-4 font-semibold text-white/82">
            <Link href="/empresa" className="hover:text-white">
              Dados da empresa
            </Link>
            <Link href="/privacidade" className="hover:text-white">
              Privacidade
            </Link>
            <Link href="/termos" className="hover:text-white">
              Termos
            </Link>
          </div>
        </div>
      </footer>

      <a
        href={whatsappHref}
        target={contactPhone ? "_blank" : undefined}
        rel={contactPhone ? "noopener noreferrer" : undefined}
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[#25d366] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/30 hover:bg-[#1ebe57]"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-current"
        >
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.02h-.01a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
        </svg>
        WhatsApp
      </a>
    </main>
  );
}
