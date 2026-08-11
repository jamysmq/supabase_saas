# Convite seguro de acesso após aprovação

O cadastro público aprovado deve entregar o primeiro acesso pelo e-mail
informado. O sistema não envia senha temporária em texto. O convite do Supabase
Auth confirma o domínio do e-mail e abre a página para a própria pessoa definir
a primeira senha.

## Fluxo

1. O administrador da plataforma aprova o cadastro.
2. O tenant e seu usuário administrador são criados.
3. O Supabase Auth envia um convite para o e-mail de acesso.
4. O link abre https://app.meuassistentevirtual.com.br/activate-account.
5. A pessoa define a senha e entra diretamente no Dashboard.
6. O painel informa se o convite foi enviado ou se o e-mail já possuía conta.

O WhatsApp pode receber futuramente apenas um aviso de aprovação. Login, senha,
token e link de ativação não devem ser enviados nesse canal.

## Pré-requisitos de produção

- configurar SMTP próprio em Supabase > Authentication > SMTP Settings;
- cadastrar em Supabase > Authentication > URL Configuration:
  - Site URL: https://app.meuassistentevirtual.com.br;
  - Redirect URL: https://app.meuassistentevirtual.com.br/activate-account;
- personalizar o template Invite user;
- manter APP_BASE_URL=https://app.meuassistentevirtual.com.br na Vercel;
- habilitar TENANT_ACCESS_INVITE_ENABLED=true somente depois de um convite
  oficial ser recebido e a definição da primeira senha ser validada.

O SMTP padrão do Supabase não é adequado para entrega a clientes em produção.
A flag deve permanecer desligada até a configuração de um remetente próprio.

O nome de usuário é o e-mail usado no cadastro. Nenhuma senha temporária em texto simples é enviada; o link pessoal seguro permite que o administrador crie a primeira senha.

## Template sugerido

Assunto: Seu acesso ao Assistente João está pronto 😊

Corpo sugerido:

    <h2>Olá! Seu cadastro foi aprovado 😊</h2>
    <p>
      O acesso de <strong>{{ .Data.tenant_name }}</strong> ao Assistente João já
      está disponível.
    </p>
    <p>
      Para confirmar este e-mail e criar sua senha, use o botão abaixo:
    </p>
    <p>
      <a href="{{ .ConfirmationURL }}">Ativar meu acesso</a>
    </p>
    <p>
      Por segurança, este link é pessoal e possui prazo de validade. Se você não
      solicitou este cadastro, ignore esta mensagem.
    </p>
    <p>Seja bem-vindo!<br>Equipe Assistente João</p>

O rastreamento de links do provedor SMTP deve ficar desligado para não reescrever
o link de autenticação.
