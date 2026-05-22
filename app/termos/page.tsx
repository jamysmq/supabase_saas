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
          O Meu Assistente Virtual e uma plataforma SaaS para gestao de
          clientes, cobrancas, agenda, pedidos e comunicacoes operacionais. O
          uso do sistema depende de acesso autorizado e do plano contratado por
          cada negocio.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Cada contratante e responsavel pela veracidade dos dados cadastrados,
          pela autorizacao de comunicacoes com seus clientes e pelo cumprimento
          das regras aplicaveis ao seu segmento de atuacao.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          A plataforma pode registrar eventos operacionais, historicos e logs
          necessarios para seguranca, auditoria, suporte e continuidade do
          servico.
        </p>
      </article>
    </main>
  );
}
