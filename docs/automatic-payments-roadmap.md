# Roadmap — pagamentos automáticos por cartão e Pix

Atualizado em 2026-07-26.

## Objetivo

Permitir que o pagador configure uma forma de pagamento recorrente e que o
billing-app faça cobrança, conciliação e tratamento de falhas sem confirmação
manual.

A implementação será dividida em dois produtos distintos:

1. **Assinatura da plataforma:** o tenant paga mensalmente à Soft Ink pelo plano
   do Jack e seus adicionais.
2. **Cobranças dos tenants:** alunos e clientes finais pagam mensalidades ao
   respectivo tenant.

O primeiro produto é o MVP. O segundo só começa depois que o primeiro estiver
estável e após aprovação comercial e regulatória do modelo de subcontas.

## Decisões de arquitetura

- Usar o **Asaas como primeiro provedor**, atrás de um adaptador interno para não
  acoplar regras de negócio diretamente à API externa.
- Implementar primeiro a assinatura da plataforma; não misturar pagamentos da
  Soft Ink com recebíveis de alunos ou clientes dos tenants.
- Para cartão, preferir **checkout hospedado e recorrente do Asaas**. O
  billing-app não deve armazenar nem registrar número completo do cartão, CVV ou
  dados sensíveis do portador.
- Para Pix Automático, o cliente não informa agência, conta ou chave Pix ao
  Jack. O app gera a autorização e o QR Code; o pagador concede o consentimento
  no aplicativo do próprio banco.
- Webhooks são a fonte de verdade para confirmação, falha, estorno,
  cancelamento e ativação de autorização. Consultas periódicas servem apenas
  para reconciliação e recuperação.
- n8n pode enviar avisos operacionais, mas não será responsável por decidir ou
  persistir o estado financeiro.
- Manter pagamento manual como fallback durante todo o rollout inicial.

## Pré-requisitos comerciais e regulatórios

Antes do desenvolvimento que movimenta valores reais:

- confirmar que a conta Asaas de produção da Soft Ink está aprovada e em nome
  de pessoa jurídica;
- solicitar e confirmar a habilitação de tokenização/recorrência de cartão em
  produção;
- confirmar a elegibilidade da conta para Pix Automático;
- validar taxas, prazo de recebimento, chargeback, estorno e política de
  cancelamento;
- confirmar com o Asaas o modelo futuro de subcontas, split e KYC para os
  tenants;
- revisar termos de uso, política de privacidade, consentimento e comunicação de
  cobrança com apoio jurídico/contábil.

Referências oficiais:

- [Assinaturas no Asaas](https://docs.asaas.com/docs/assinaturas)
- [Assinatura com cartão](https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito)
- [Checkout recorrente](https://docs.asaas.com/docs/checkout-com-assinatura-recorrente)
- [Pix Automático](https://docs.asaas.com/docs/pix-automatico)
- [Webhooks do Pix Automático](https://docs.asaas.com/docs/fluxos-de-webhook)
- [Eventos de cobrança](https://docs.asaas.com/docs/webhook-para-cobrancas)
- [Subcontas](https://docs.asaas.com/reference/criar-subconta)
- [Split de pagamentos](https://docs.asaas.com/docs/split-de-pagamentos)

## Experiência do tenant — MVP

Criar uma área **Assinatura e pagamento** no painel do tenant.

Ela deve exibir:

- plano base, adicionais e valor mensal total;
- situação da assinatura;
- forma de pagamento atual;
- próximo vencimento;
- últimas cobranças e seus estados;
- ação para configurar ou trocar a forma de pagamento;
- ação para regularizar cobrança pendente;
- orientação clara para cancelamento ou revogação.

### Cartão

1. O tenant escolhe **Cartão de crédito**.
2. O backend cria uma sessão de checkout recorrente no Asaas com idempotência.
3. O navegador abre o checkout hospedado.
4. O Asaas valida o cartão e cria a recorrência.
5. O callback apenas devolve o usuário ao painel.
6. A ativação definitiva ocorre pelo webhook confirmado.
7. O painel mostra somente dados mascarados permitidos, como bandeira e quatro
   últimos dígitos, quando fornecidos pelo provedor.

### Pix Automático

1. O tenant escolhe **Pix Automático**.
2. O backend cria uma autorização vinculada ao cliente Asaas.
3. O painel exibe QR Code, Pix copia e cola, valor inicial e prazo.
4. O primeiro pagamento registra o consentimento no banco do pagador.
5. O webhook ativa a autorização dentro do billing-app.
6. As cobranças seguintes são geradas dentro dos limites autorizados.
7. Revogação, recusa, expiração e falha ficam visíveis no painel.

## Arquitetura proposta

### Adaptador de provedor

Criar uma interface server-side com operações como:

- criar ou localizar cliente no provedor;
- criar checkout recorrente de cartão;
- criar autorização de Pix Automático;
- consultar autorização e cobrança;
- criar cobrança recorrente quando aplicável;
- cancelar assinatura ou autorização;
- solicitar estorno;
- validar e normalizar eventos de webhook.

O primeiro adaptador será Asaas. Rotas e componentes não devem depender de
nomes de campos específicos do provedor.

### Endpoints previstos

- GET /api/tenant-subscription
- POST /api/tenant-subscription/payment-method/card
- POST /api/tenant-subscription/payment-method/pix-automatic
- POST /api/tenant-subscription/payment-method/cancel
- POST /api/tenant-subscription/retry
- POST /api/webhooks/asaas
- POST /api/internal/payments/reconcile

Todas as rotas do tenant devem validar autenticação, vínculo com o tenant e
estado do plano no backend.

### Modelo de dados

Preservar subscriptions, platform_tenant_billing_profiles, payments e
platform_payment_events. Acrescentar estruturas específicas de integração:

#### payment_provider_customers

- id
- scope: platform_subscription ou tenant_receivable
- tenant_id
- provider
- provider_customer_id
- status
- timestamps

#### platform_payment_methods

- id
- tenant_id
- provider_customer_id
- provider
- method_type: credit_card ou pix_automatic
- status
- provider_subscription_id
- provider_authorization_id
- dados mascarados permitidos do cartão
- is_default
- timestamps

#### payment_provider_events

- id
- provider
- provider_event_id com índice único
- event_type
- scope
- tenant_id
- referências internas de pagamento/assinatura
- payload bruto restrito ao service role
- processing_status
- received_at, processed_at e mensagem de erro

#### Evolução de payments

- manter o ID interno como identidade principal;
- vincular provider_payment_id e provider_event_id;
- registrar vencimento, confirmação, valor bruto, valor líquido, taxa,
  estorno e método;
- mapear estados do provedor para estados internos sem expor texto externo como
  regra de negócio.

Nenhuma tabela deve receber PAN, CVV, senha bancária, agência/conta do pagador
ou chave de API sem criptografia dedicada.

## Processamento de webhook

1. Validar o header obrigatório asaas-access-token.
2. Persistir o evento antes de executar efeitos.
3. Deduplicar por provider_event_id.
4. Responder 2xx rapidamente.
5. Processar o evento de forma idempotente.
6. Atualizar pagamento, assinatura/autorização e evento histórico na mesma
   operação transacional quando possível.
7. Ignorar atributos desconhecidos sem interromper a fila.
8. Registrar falhas para retentativa e alerta.

Eventos mínimos:

- criação e atualização da cobrança;
- confirmação e recebimento;
- vencimento;
- falha ou recusa;
- estorno, chargeback e cancelamento;
- ativação, recusa, expiração e cancelamento da autorização Pix;
- criação, agendamento, recusa e cancelamento da instrução Pix recorrente.

## Fases de implementação

### Fase 0 — decisão comercial e desenho final

- [ ] Abrir/validar conta Asaas Sandbox e produção da Soft Ink.
- [ ] Confirmar cartão recorrente, Pix Automático e tokenização em produção.
- [ ] Levantar taxas, prazos, limites e políticas.
- [ ] Definir carência, tentativas e regra de suspensão.
- [ ] Confirmar que o MVP cobra apenas a assinatura da plataforma.

**Saída:** provedor e regras operacionais aprovados antes de criar migrations.

### Fase 1 — fundação técnica

- [ ] Criar adaptador de pagamentos e configuração server-only.
- [ ] Criar migration de clientes externos, métodos, autorizações e eventos.
- [ ] Criar webhook autenticado e idempotente.
- [ ] Criar reconciliação read-only e alertas.
- [ ] Adicionar feature flag e allowlist de tenants.

**Saída:** eventos falsos/duplicados não geram dupla baixa nem mudança cruzada
entre tenants.

### Fase 2 — cartão recorrente da plataforma

- [ ] Criar checkout hospedado.
- [ ] Vincular cliente, assinatura e cobranças Asaas aos registros atuais.
- [ ] Criar tela de configuração e retorno do checkout.
- [ ] Tratar aprovação, recusa, cartão expirado, estorno e chargeback.
- [ ] Refletir pagamento no histórico e no financeiro da plataforma.

**Saída:** ciclo completo aprovado no Sandbox, inclusive webhook duplicado.

### Fase 3 — Pix Automático da plataforma

- [ ] Criar autorização e primeiro QR Code.
- [ ] Exibir consentimento pendente, ativo, recusado, expirado ou cancelado.
- [ ] Gerar e conciliar instruções dos ciclos seguintes.
- [ ] Evitar débito duplicado quando o ciclo já estiver pago.
- [ ] Permitir revogação e troca de método.

**Saída:** autorização, primeiro pagamento, recorrência seguinte e revogação
validados ponta a ponta.

### Fase 4 — cobrança, recuperação e operação

- [ ] Definir régua de lembrete anterior ao vencimento.
- [ ] Implementar retentativas sem duplicidade.
- [ ] Criar período de carência antes de suspender.
- [ ] Não suspender automaticamente no primeiro rollout.
- [ ] Criar painel operacional de divergências, falhas e webhooks.
- [ ] Manter confirmação manual auditada como contingência.

**Saída:** equipe consegue explicar e corrigir qualquer divergência pelo
histórico de eventos.

### Fase 5 — rollout de produção

- [ ] Homologar tudo no Sandbox com dados fictícios.
- [ ] Ativar produção apenas para um tenant controlado.
- [ ] Fazer uma cobrança oficial de baixo valor em cartão.
- [ ] Fazer uma autorização e cobrança oficial de baixo valor em Pix
  Automático.
- [ ] Conferir valor bruto, taxa, líquido, webhook e baixa interna.
- [ ] Expandir por allowlist e monitorar uma competência completa.
- [ ] Só depois tornar a configuração disponível aos demais tenants.

**Saída:** uma competência mensal completa conciliada sem intervenção manual.

### Fase 6 — pagamentos dos clientes finais dos tenants

Esta fase é um épico separado.

- [ ] Confirmar aprovação regulatória/comercial para subcontas.
- [ ] Definir onboarding KYC de cada tenant.
- [ ] Definir se a cobrança é emitida pela subconta do tenant.
- [ ] Definir comissão e split, sem misturar saldos.
- [ ] Guardar chaves de subconta em cofre/KMS, nunca em tabela aberta.
- [ ] Adaptar billing_cycles para cobrança externa e conciliação.
- [ ] Implementar cartão e Pix Automático por tenant.
- [ ] Garantir que um webhook nunca baixe ciclo de outro tenant.
- [ ] Tratar repasse, estorno, chargeback, taxas e relatórios.

**Saída:** piloto com um único tenant aprovado, antes de liberar a plataforma.

## Segurança e privacidade

- Checkout hospedado para reduzir exposição a dados de cartão.
- Nunca armazenar PAN completo ou CVV.
- Nunca registrar dados sensíveis em logs, analytics ou payload de erro.
- Chaves Asaas somente no servidor e em segredo de ambiente/cofre.
- Token de webhook independente das API keys.
- RLS negando acesso do cliente aos payloads brutos.
- Idempotência em criação de checkout, autorização, cobrança e webhook.
- Rate limit nas rotas de criação e retentativa.
- Auditoria imutável de mudança de método, baixa, estorno e cancelamento.
- Política de retenção e minimização de dados alinhada à LGPD.
- Revisão jurídica e contábil antes do go-live; este roadmap não substitui essa
  validação.

## Matriz mínima de testes

### Cartão

- aprovado, recusado e em análise de risco;
- cartão inválido ou expirado;
- callback recebido antes/depois do webhook;
- webhook duplicado e fora de ordem;
- troca de plano ou adicional;
- estorno parcial/total e chargeback;
- troca e cancelamento de método.

### Pix Automático

- autorização criada, ativada, recusada, expirada e cancelada;
- primeiro pagamento não concluído;
- instrução criada, agendada, recusada e cancelada;
- pagamento antecipado sem débito duplicado;
- saldo insuficiente e nova tentativa;
- revogação no banco refletida no Jack.

### Multi-tenant

- IDs externos não podem ser reutilizados em outro tenant;
- evento de um tenant não altera assinatura ou ciclo de outro;
- duas entregas do mesmo webhook produzem um único efeito;
- valores de plano, Plus e profissionais adicionais são preservados;
- fallback manual gera histórico sem duplicar a baixa automática.

## Critérios para considerar o MVP concluído

- cartão e Pix Automático configuráveis pelo tenant;
- nenhum dado bruto de cartão armazenado;
- webhooks autenticados, persistidos e idempotentes;
- pagamentos refletidos automaticamente no histórico da plataforma;
- falhas, cancelamentos, estornos e revogações visíveis;
- reconciliação detecta divergência sem alterar dados silenciosamente;
- rollout controlado conclui uma competência real;
- runbook de operação e rollback aprovado.

## Decisões pendentes do produto

Recomendação inicial entre parênteses:

1. Carência após falha: **quantos dias?** (7 dias).
2. Retentativa de cartão: **quantas e em quais dias?** (D+1 e D+3).
3. Suspensão: **automática ou revisada?** (revisada no primeiro mês).
4. Taxas: **absorvidas ou repassadas?** (absorvidas na assinatura do Jack).
5. Novo tenant: **paga antes ou depois da aprovação?** (depois da aprovação e
   antes da ativação definitiva).
6. Clientes finais dos tenants: **há comissão do Jack?** (decidir somente na
   Fase 6).
