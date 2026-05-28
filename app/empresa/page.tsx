import Link from "next/link";

export default function CompanyPage() {
  return (
    <main className="min-h-screen bg-[#f7fbff] px-6 py-12 text-[#07111f] sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link className="text-sm font-semibold text-[#073a86]" href="/">
          Voltar
        </Link>

        <h1 className="mt-8 text-3xl font-bold">Dados da empresa</h1>

        <section className="mt-6 rounded-md border border-[#d7e6f5] bg-white p-6 shadow-sm">
          <dl className="grid gap-5 text-sm leading-7">
            <div>
              <dt className="font-bold text-[#073a86]">
                Nome empresarial / razão social
              </dt>
              <dd className="mt-1 text-[#25364a]">
                67.015.907/0001-03 JAMYS MEDEIROS QUARESMA
              </dd>
            </div>
            <div>
              <dt className="font-bold text-[#073a86]">Marca e produto</dt>
              <dd className="mt-1 text-[#25364a]">
                Meu Assistente Virtual e Assistente Jack
              </dd>
            </div>
            <div>
              <dt className="font-bold text-[#073a86]">Domínio oficial</dt>
              <dd className="mt-1 text-[#25364a]">
                www.meuassistentevirtual.com.br
              </dd>
            </div>
            <div>
              <dt className="font-bold text-[#073a86]">Contato</dt>
              <dd className="mt-1 text-[#25364a]">
                contato@meuassistentevirtual.com.br
              </dd>
            </div>
          </dl>
        </section>

        <p className="mt-6 text-sm leading-7 text-[#44546a]">
          O domínio, a marca Meu Assistente Virtual e o produto Assistente Jack
          são mantidos pelo nome empresarial informado acima.
        </p>
      </article>
    </main>
  );
}
