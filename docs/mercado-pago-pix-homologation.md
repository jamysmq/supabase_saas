# Homologação do Pix dinâmico do Mercado Pago

Este roteiro ativa o Pix dinâmico de forma controlada, sem substituir a chave Pix
manual antes de a integração oficial estar confirmada.

## Pré-requisitos

- conexão OAuth do tenant em modo produção e com token válido;
- e-mail válido no cadastro do pagador usado no teste;
- URL de webhook cadastrada no painel do Mercado Pago:
  `https://app.meuassistentevirtual.com.br/api/payment-providers/mercado-pago/webhook`;
- tópicos de produção habilitados no Mercado Pago:
  - `Pagamentos` legado (`payment`), para conciliação das cobranças;
  - `Vinculação de aplicações` (`mp-connect`), para autorização e
    desautorização da conexão OAuth;
  - `Planos e assinaturas`, reservado para o bloco de recorrência; enquanto não
    houver assinaturas, seus eventos são ignorados com segurança;
- os demais tópicos devem permanecer desabilitados até que seus handlers sejam
  implementados no webhook;
- assinatura secreta do webhook salva somente em ambiente seguro como
  `MERCADO_PAGO_WEBHOOK_SECRET`;
- automação de cobrança e modo `provider_dynamic` ainda desligados.

## Publicação da assinatura

1. Salvar a assinatura em `.env.local`, sem colocá-la em commits, mensagens ou
   documentação.
2. Publicar `MERCADO_PAGO_WEBHOOK_SECRET` como variável sensível no ambiente
   Production da Vercel.
3. Confirmar a variável
   `MERCADO_PAGO_WEBHOOK_URL=https://app.meuassistentevirtual.com.br/api/payment-providers/mercado-pago/webhook`.
4. Fazer novo deploy de produção.
5. Confirmar que uma chamada sem assinatura é recusada e que o simulador oficial
   do Mercado Pago é aceito.

## Primeiro teste oficial

1. Criar ou escolher um cliente controlado com e-mail válido.
2. Criar uma cobrança de baixo valor exclusivamente para homologação.
3. Ativar a automação apenas no tenant controlado.
4. Gerar o Pix pela tela de cobranças pendentes.
5. Repetir a solicitação e confirmar que ela reutiliza a mesma tentativa, sem
   gerar cobrança duplicada.
6. Pagar o Pix.
7. Confirmar:
   - evento assinado recebido uma única vez;
   - cobrança do provedor marcada como conciliada;
   - ciclo financeiro marcado como `paid_mercado_pago`;
   - data e observação de pagamento preenchidas;
   - registro disponível no histórico financeiro.
8. Repetir a notificação pelo simulador e confirmar que não há segunda baixa.

## Critérios de interrupção

Desligar imediatamente a automação e manter a chave Pix manual se ocorrer qualquer
um destes casos:

- assinatura inválida ou webhook indisponível;
- divergência entre valor local e valor retornado pelo provedor;
- conta Mercado Pago diferente da conta vinculada;
- tentativa de alterar ciclo já pago manualmente;
- evento sem referência inequívoca ao ciclo e ao tenant.

As divergências devem permanecer na fila de conciliação para revisão manual. Não
se deve corrigir o status do ciclo automaticamente nesses casos.

## Encerramento

Depois da baixa oficial validada, manter o tenant controlado em observação e só
então liberar o modo dinâmico para outros tenants. A chave Pix cadastrada pelo
tenant continua sendo o modo padrão e o fallback operacional.
