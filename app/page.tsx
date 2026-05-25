import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#171717]">
      <section className="border-b border-[#d8d2c4] bg-[#fbfaf7]">
        <div className="mx-auto flex min-h-[92vh] w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-6">
            <Link className="text-sm font-semibold uppercase tracking-[0.16em]" href="/">
              Assistente Jack
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[#4a463f]">
              <Link className="hover:text-[#171717]" href="/privacidade">
                Privacidade
              </Link>
              <Link className="hover:text-[#171717]" href="/termos">
                Termos
              </Link>
              <Link
                className="rounded-md bg-[#1f3d36] px-4 py-2 font-medium text-white hover:bg-[#172d28]"
                href="/login"
              >
                Entrar
              </Link>
            </nav>
          </header>

          <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.04fr_0.96fr]">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[#806d34]">
                Um produto Meu Assistente Virtual
              </p>
              <h1 className="text-4xl font-semibold leading-tight text-[#171717] sm:text-5xl lg:text-6xl">
                Assistente Jack
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#4a463f]">
                O gerente virtual para pequenos negócios organizarem clientes,
                pagamentos, agendamentos, pedidos e conversas via WhatsApp com
                mais controle operacional.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="rounded-md bg-[#1f3d36] px-5 py-3 text-center text-sm font-semibold text-white hover:bg-[#172d28]"
                  href="/login"
                >
                  Acessar painel
                </Link>
                <a
                  className="rounded-md border border-[#b8ad98] px-5 py-3 text-center text-sm font-semibold text-[#1f3d36] hover:border-[#1f3d36] hover:bg-white"
                  href="mailto:contato@meuassistentevirtual.com.br"
                >
                  Falar com atendimento
                </a>
              </div>
            </div>

            <div className="relative min-h-[420px] overflow-hidden rounded-md border border-[#d8d2c4] bg-[#e9e2d4] p-5 shadow-sm">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(31,61,54,0.12),rgba(128,109,52,0.08))]" />
              <div className="relative grid h-full grid-rows-[auto_1fr_auto] gap-5">
                <div className="flex items-center justify-between rounded-md bg-white/85 p-4 shadow-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-[#806d34]">
                      Operação
                    </p>
                    <p className="mt-1 text-lg font-semibold">Resumo do dia</p>
                  </div>
                  <div className="h-3 w-3 rounded-full bg-[#1f8a5b]" />
                </div>

                <div className="grid content-center gap-4">
                  {[
                    ["Cobranças", "Clientes com ciclos pendentes e histórico de baixa."],
                    ["Agenda", "Serviços, profissionais e confirmações por WhatsApp."],
                    ["Restaurante", "Cardápio, pedidos e financeiro em um só painel."],
                  ].map(([title, description]) => (
                    <div
                      className="rounded-md border border-white/70 bg-white/80 p-4 shadow-sm"
                      key={title}
                    >
                      <p className="font-semibold text-[#1f3d36]">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#4a463f]">
                        {description}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="rounded-md bg-[#1f3d36] p-4 text-white">
                  <p className="text-sm font-medium">
                    Regras por plano validadas no painel, APIs e banco.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-14 sm:px-8 lg:grid-cols-3 lg:px-10">
          {[
            ["Multi-tenant", "Cada cliente opera seus próprios dados, com separação por tenant e controles administrativos."],
            ["WhatsApp oficial", "Integração preparada para WhatsApp Cloud API, webhook seguro e workflows genéricos no n8n."],
            ["Histórico auditável", "Pagamentos, agendamentos e exclusões preservam eventos importantes para consulta futura."],
          ].map(([title, description]) => (
            <article className="border-l-2 border-[#b89a44] pl-5" key={title}>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#4a463f]">
                {description}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
