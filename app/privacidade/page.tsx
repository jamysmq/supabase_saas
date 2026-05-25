import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#fbfaf7] px-6 py-12 text-[#171717] sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link className="text-sm font-medium text-[#1f3d36]" href="/">
          Voltar
        </Link>
        <h1 className="mt-8 text-3xl font-semibold">Política de Privacidade</h1>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          O Assistente Jack, produto da Meu Assistente Virtual, trata dados de
          contato, cadastro, cobrança, agenda, pedidos e mensagens operacionais
          para prestar o serviço aos negócios contratantes. Os dados são usados
          para autenticar usuários, operar os painéis, registrar históricos e
          executar comunicações autorizadas pelos clientes da plataforma.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Informações sensíveis de integração, como chaves de API e tokens, são
          mantidas em variáveis de ambiente e não devem ser compartilhadas por
          canais públicos. O acesso administrativo é restrito aos operadores
          autorizados.
        </p>
        <p className="mt-4 text-sm leading-7 text-[#4a463f]">
          Para solicitações sobre privacidade, acesso, correção ou exclusão de
          dados, entre em contato pelo e-mail
          contato@meuassistentevirtual.com.br.
        </p>
      </article>
    </main>
  );
}
