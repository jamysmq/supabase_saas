import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#fbfaf7] px-6 py-12 text-[#171717] sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link className="text-sm font-medium text-[#1f3d36]" href="/">
          Voltar
        </Link>
        <h1 className="mt-8 text-3xl font-semibold">Politica de Privacidade</h1>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          O Assistente Jack, produto da Meu Assistente Virtual, trata dados de
          contato, cadastro, cobranca, agenda, pedidos e mensagens operacionais
          para prestar o servico aos negocios contratantes. Os dados sao usados
          para autenticar usuarios, operar os paineis, registrar historicos e
          executar comunicacoes autorizadas pelos clientes da plataforma.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Informacoes sensiveis de integracao, como chaves de API e tokens, sao
          mantidas em variaveis de ambiente e nao devem ser compartilhadas por
          canais publicos. O acesso administrativo e restrito aos operadores
          autorizados.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Para solicitacoes sobre privacidade, acesso, correcao ou exclusao de
          dados, entre em contato pelo e-mail
          contato@meuassistentevirtual.com.br.
        </p>
      </article>
    </main>
  );
}
