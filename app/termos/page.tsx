import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#fbfaf7] px-6 py-12 text-[#171717] sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link className="text-sm font-medium text-[#1f3d36]" href="/">
          Voltar
        </Link>
        <h1 className="mt-8 text-3xl font-semibold">Termos de Uso</h1>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          O Assistente Jack é um produto da Meu Assistente Virtual para gestão
          de clientes, cobranças, agenda, pedidos e comunicações operacionais.
          O uso do sistema depende de acesso autorizado e do plano contratado
          por cada negócio.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Cada contratante é responsável pela veracidade dos dados cadastrados,
          pela autorização de comunicações com seus clientes e pelo cumprimento
          das regras aplicáveis ao seu segmento de atuação.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          A plataforma pode registrar eventos operacionais, históricos e logs
          necessários para segurança, auditoria, suporte e continuidade do
          serviço.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Meu Assistente Virtual e Assistente Jack são operados por 67.015.907
          JAMYS MEDEIROS QUARESMA. Consulte também os{" "}
          <Link className="font-semibold text-[#073a86]" href="/empresa">
            dados da empresa
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
