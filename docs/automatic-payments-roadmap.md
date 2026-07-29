# Roadmap — pagamentos dos clientes dos tenants

Atualizado em 2026-07-29.

## Objetivo

Permitir que cada tenant receba pagamentos dos próprios alunos e clientes em
sua própria conta financeira, sem que a Soft Ink custodie ou misture valores.
O billing-app deve gerar cobranças, acompanhar estados e conciliar o financeiro
automaticamente quando houver um provedor conectado.

Este roadmap trata primeiro dos **recebíveis dos tenants**. A cobrança da
assinatura do Jack paga pelo tenant à Soft Ink reutilizará a mesma arquitetura
em um épico posterior, mantendo dados e saldos separados.

## Decisões definitivas

- O Pix configurado em `tenant_billing_settings` continua sendo o padrão e o
  fallback de todos os tenants.
- Um QR Pix estático pode ser gerado localmente a partir da chave do tenant; ele
  não oferece confirmação automática.
- QR Pix dinâmico, cartão e conciliação automática exigem uma conta de provedor
  conectada pelo próprio tenant.
- Em uma cobrança automática não será exibida simultaneamente a chave Pix
  manual, porque um pagamento fora do provedor não pode ser associado com
  segurança ao ciclo que originou a cobrança.
- O primeiro adaptador será **Mercado Pago via OAuth**, por permitir que o
  titular autorize uma conta existente sem copiar uma credencial ampla.
- O segundo adaptador será **Asaas**. Conta existente usa API Key criptografada;
  subcontas/BaaS somente após acordo comercial e avaliação regulatória.
- Nenhum fluxo armazenará PAN, CVV, senha bancária ou credencial em texto
  aberto. Cartão usa checkout hospedado/tokenização do provedor.
- Webhooks persistidos e idempotentes são a fonte de verdade. Consultas à API
  servem para reconciliação e recuperação.
- O n8n pode enviar mensagens, mas não decide nem persiste estado financeiro.
- Toda automação nasce desativada e é liberada por tenant após homologação.

## Modos de Pix

### Chave do tenant — padrão

- Usa chave e beneficiário já configurados no painel.
- Pode mostrar chave, copia e cola e QR estático gerado localmente.
- A confirmação permanece manual e auditada.
- Não há taxa ou dependência de gateway no billing-app.

### Pix dinâmico do provedor — opt-in

- Cria uma cobrança individual vinculada ao `billing_cycle`.
- Exibe somente o QR e o copia e cola retornados pelo provedor.
- Webhook aprovado baixa o ciclo e registra taxa, líquido e horário.
- Expiração, cancelamento, estorno e divergência ficam auditáveis.

### Pix Automático

É um produto diferente de uma cobrança Pix dinâmica. Só entrará após confirmar
elegibilidade, consentimento, recorrência e webhooks no provedor escolhido. Até
lá, “Pix automático” no produto significa automação de geração e conciliação,
não débito sem nova autorização do pagador.

## Arquitetura comum

Os componentes de tela e as regras financeiras dependem apenas do contrato
interno em `src/lib/payments/provider-contract.ts`.

Cada adaptador deve normalizar:

- conexão e capacidades da conta;
- criação, consulta e cancelamento de cobrança;
- Pix dinâmico e checkout hospedado de cartão;
- estados `created`, `pending`, `paid`, `failed`, `expired`, `cancelled`,
  `refunded` e `chargeback`;
- IDs externos, valor bruto, taxa, líquido e datas;
- validação e normalização de webhook.

Credenciais serão cifradas com AES-256-GCM antes de chegar ao banco. A chave
`PAYMENT_CREDENTIALS_ENCRYPTION_KEY` é exclusivamente server-side e deve ficar
nos segredos de produção, com versão preparada para futura rotação.

## Blocos de implementação

### Bloco 0 — fundação segura e neutra de provedor

- [x] Definir modos `tenant_key` e `provider_dynamic` sem alterar o padrão atual.
- [x] Criar contrato TypeScript independente de Mercado Pago e Asaas.
- [x] Criar migration `064_tenant_payment_provider_foundation.sql`.
- [x] Modelar conexões, cobranças externas e eventos idempotentes por tenant.
- [x] Impedir por FK composta que uma conexão ou cobrança atravesse tenants.
- [x] Negar acesso direto do cliente a credenciais, payloads e eventos brutos.
- [x] Implementar criptografia AES-256-GCM para credenciais server-side.
- [x] Aplicar a migration 064 em produção e confirmar automação desativada.

**Não faz parte:** OAuth, API Key real, webhook público, QR, checkout ou cobrança.

**Saída:** banco e contratos prontos, sem movimentar valores e sem alterar a
experiência existente.

### Bloco 1 — Pix manual aprimorado

- [x] Exibir modo atual e chave Pix nas configurações financeiras.
- [x] Gerar copia e cola BR Code e QR estático localmente.
- [x] Incluir valor e referência quando compatíveis com o QR estático.
- [x] Manter confirmação manual auditada no financeiro.
- [x] Tratar chave ausente ou inválida sem interromper lembretes.

Implementado pela migration 065, gerador BR Code validado contra o vetor oficial
do BCB e rota autenticada por tenant. O QR é criado sob demanda para um ciclo
pendente, sem persistir o payload e sem ativar automação.

**Saída:** tenant usa QR sem gateway, sabendo que a baixa é manual.

### Bloco 2 — conexão Mercado Pago

- [x] Configurar a chave de criptografia na Vercel antes do primeiro OAuth.
- [x] Registrar aplicação produtiva e URLs de callback.
- [x] Implementar OAuth Authorization Code com `state` de uso único e PKCE.
- [x] Trocar e renovar tokens somente no servidor.
- [x] Cifrar tokens antes de persistir e nunca retorná-los ao navegador.
- [x] Consultar conta autorizada e impedir a mesma conta em dois tenants.
- [x] Criar tela Conectar, reconectar e desconectar Mercado Pago.
- [x] Exibir somente conta, situação e capacidades não sensíveis.

As migrations 066 e 067 criam o estado OAuth efêmero, negam acesso direto pelo
cliente e vinculam cada tentativa ao usuário do mesmo tenant. Em 2026-07-29, a
aplicação produtiva, o callback exato e a primeira autorização oficial foram
validados sem habilitar cobranças automáticas.

**Saída:** um tenant controlado conecta e revoga sua conta sem criar cobrança.

### Bloco 3 — Pix dinâmico e conciliação

- [ ] Criar cobrança Pix com idempotência e `external_reference` interna.
- [ ] Vincular cobrança ao tenant, cliente e `billing_cycle`.
- [ ] Criar webhook autenticado, persistido e idempotente.
- [ ] Consultar o recurso no provedor antes de efetivar a baixa.
- [ ] Atualizar ciclo e histórico em transação única.
- [ ] Tratar pagamento, expiração, falha, cancelamento e estorno.
- [ ] Criar reconciliação read-only e fila de divergências.

**Saída:** Pix de baixo valor confirmado automaticamente sem baixa duplicada.

### Bloco 4 — cartão e recorrência

- [ ] Usar checkout hospedado; nenhum campo de cartão no billing-app.
- [ ] Criar pagamento avulso e, quando contratado, assinatura recorrente.
- [ ] Guardar somente identificadores e dados mascarados permitidos.
- [ ] Tratar recusa, retentativa, cartão expirado, estorno e chargeback.
- [ ] Permitir troca e cancelamento do método pelo pagador.
- [ ] Não suspender cliente automaticamente no primeiro rollout.

**Saída:** cartão homologado ponta a ponta com webhook duplicado e fora de ordem.

### Bloco 5 — adaptador Asaas

- [ ] Confirmar condições comerciais e modalidade de integração.
- [ ] Conectar conta existente por API Key criptografada.
- [ ] Validar a conta antes de habilitar qualquer capacidade.
- [ ] Implementar Pix, cartão/assinatura e webhooks no contrato comum.
- [ ] Avaliar subcontas/BaaS separadamente, sem presumir aprovação regulatória.

**Saída:** trocar o provedor não muda regras de negócio nem telas financeiras.

### Bloco 6 — WhatsApp e operação financeira

- [ ] Oferecer link/QR automático somente quando houver cobrança válida.
- [ ] Preservar o template com chave Pix no modo manual.
- [ ] Criar segunda via sem gerar cobrança duplicada.
- [ ] Mostrar origem, provedor, método, taxa e líquido no financeiro.
- [ ] Criar painel de conexões, webhooks e divergências para a plataforma.
- [ ] Manter baixa manual como contingência com auditoria.

**Saída:** suporte consegue explicar e corrigir qualquer divergência pelo painel.

### Bloco 7 — rollout de produção

- [ ] Homologar primeiro com contas e pagadores de teste do provedor.
- [ ] Ativar somente para um tenant controlado.
- [ ] Realizar Pix oficial de baixo valor e conferir bruto, taxa e líquido.
- [ ] Realizar cartão oficial de baixo valor e estorno controlado.
- [ ] Monitorar eventos duplicados, atrasados e falhas por uma competência.
- [ ] Expandir por allowlist antes de liberar conexão para todos.

**Saída:** uma competência conciliada sem mistura entre tenants.

### Bloco 8 — extensões posteriores

- [ ] Pix Automático regulado, se habilitado pelo provedor.
- [ ] Cobrança da assinatura do Jack usando o mesmo núcleo, em escopo separado.
- [ ] Novos provedores somente quando houver demanda comercial comprovada.
- [ ] Split/comissão apenas após decisão jurídica, contábil e regulatória.

## Segurança obrigatória

- Credenciais cifradas com chave fora do banco.
- Service role como único acesso às tabelas brutas de integração.
- OAuth com `state`, PKCE, callback exato e proteção contra repetição.
- Verificação de assinatura/token e consulta confirmatória nos webhooks.
- Idempotência em conexão, cobrança, webhook, baixa e estorno.
- FKs compostas com `tenant_id`, conexão e provedor.
- Nunca registrar tokens, QR copia e cola, PAN ou CVV em logs de aplicação.
- Minimização e retenção de payloads alinhadas à LGPD.
- Checkout hospedado para reduzir o escopo PCI.
- Revisão jurídica e contábil antes da liberação geral.

## Matriz mínima de testes

### Isolamento e idempotência

- conexão de um tenant não pode ser usada por outro;
- a mesma conta externa não pode ser conectada a dois tenants;
- duas entregas do mesmo evento produzem um efeito;
- evento fora de ordem não regride pagamento confirmado;
- cobrança paga manualmente não recebe segunda baixa automática;
- falha parcial pode ser retomada sem gerar nova cobrança indevida.

### Pix

- chave ausente, CPF/CNPJ, telefone, e-mail e chave aleatória;
- QR estático válido e confirmação manual;
- Pix dinâmico criado, pago, expirado, cancelado e estornado;
- pagamento direto na chave não é apresentado como conciliado pelo provedor.

### Cartão

- aprovado, recusado e em análise;
- cartão inválido ou expirado;
- callback antes e depois do webhook;
- retentativa e troca de método;
- estorno parcial/total e chargeback.

## Referências oficiais

- [Manual de Padrões para Iniciação do Pix — Banco Central](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf)
- [OAuth Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation)
- [Webhooks Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks)
- [Assinaturas Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview)
- [Autenticação Asaas](https://docs.asaas.com/docs/authentication)
- [Cobranças Pix Asaas](https://docs.asaas.com/docs/cobrancas-via-pix)
- [Webhooks de cobranças Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas)
- [Assinaturas Asaas](https://docs.asaas.com/docs/faq-assinaturas)
- [Subcontas Asaas](https://docs.asaas.com/docs/duvidas-frequentes-subcontas)
