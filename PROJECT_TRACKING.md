# Billing App Tracking

Atualizado em: 2026-05-18

## Visao Geral

Este projeto e um SaaS multi-tenant para gestao de cobrancas, clientes/alunos e agenda. O produto tem dois contextos claros:

- Plataforma: nosso painel administrativo, onde gerenciamos tenants, planos, cobranca da plataforma e historico operacional.
- Tenant: painel do cliente contratante, onde ele gerencia seus proprios clientes/alunos, grupos/turmas, cobrancas, agenda e historicos.

Premissa central: o tenant e o registro solido do cliente da plataforma. Os dados operacionais dele podem ser removidos quando o tenant for excluido, mas o historico da plataforma precisa preservar um snapshot minimo da existencia e exclusao desse tenant para auditoria.

## Estado Atual

- Repositorio GitHub: `https://github.com/jamysmq/supabase_saas.git`
- App local Next.js com rotas App Router e APIs server-side usando Supabase service role quando a operacao exige controle administrativo.
- Supabase ja possui tenants, planos, usuarios de tenant, cobrancas de clientes, pagamentos da plataforma, agendamentos, historicos e tabelas/eventos auxiliares.
- n8n ja possui workflows de onboarding/cadastro e lembretes; o fluxo tenant-side de agenda ainda sera derivado do `WA_TENANT_INBOUND_Assistant_v1`.
- Hardening inicial de RLS e grants ja foi aplicado e validado superficialmente navegando pelas telas.

## Premissas de Produto

- Plano e o pilar de disponibilidade de funcionalidades, mas a regra deve ser por capacidade do plano, nao por texto espalhado no front.
- `plan1`: cobrancas mensais via WhatsApp e controle de alunos/clientes no site.
- `plan2`: agendamento via WhatsApp e controle de agendamentos no site.
- `plan3`: soma do `plan1` e `plan2`; cobrancas, alunos/clientes e agenda.
- `plan4`: restaurantes; modulo futuro com WhatsApp, mensagem inicial personalizavel e cardapio alimentado pelo tenant no site.
- Agenda fica disponivel para planos com capacidade de agenda: `plan2` e `plan3`.
- Cobrancas, alunos/clientes e turmas/grupos ficam disponiveis para planos com capacidade de cobranca mensal: `plan1` e `plan3`.
- Alterar plano deve atualizar imediatamente restricoes e valor base da mensalidade.
- Valor de mensalidade do tenant pode ser ajustado individualmente depois da selecao do plano.
- Criacao de tenant deve gerar cobranca inicial pendente para a plataforma.
- Criacao de cliente/aluno do tenant deve gerar ciclo inicial pendente para o tenant.
- Pausa/reativacao de cobranca deve virar evento historico.
- Confirmacao manual de pagamento deve virar evento historico.
- Exclusao logica e preferida quando a tela/historico do proprio contexto precisa continuar mostrando o registro.
- Exclusao fisica do tenant pode apagar historicos internos dele, desde que a plataforma preserve snapshot/auditoria.

## Funcionalidades Concluidas

### Plataforma

- Lista de tenants com status de pagamento.
- Criacao de tenants por tipo de negocio.
- Edicao de plano e valor individual de mensalidade.
- Regras de plano refletindo acesso a agenda.
- Exclusao de tenant com snapshot de evento antes da remocao.
- Pagamentos pendentes da plataforma.
- Confirmacao manual de pagamento da plataforma.
- Exclusao logica de pagamento da plataforma.
- Historico de pagamentos/eventos da plataforma.

### Tenant

- Dashboard com acesso condicionado as capacidades do plano.
- Clientes/alunos ativos e inativos.
- Criacao, edicao, movimentacao e desativacao de cliente/aluno.
- Grupos/turmas com criacao, edicao e exclusao.
- Criacao automatica de ciclo inicial pendente ao cadastrar cliente/aluno.
- Pagamentos pendentes em modo lista compacto.
- Confirmacao manual de pagamento pendente.
- Historico de pagamentos do tenant.
- Registro historico de pausa/reativacao de cobranca.

### Agenda

- Agenda liberada para `plan2` e `plan3`.
- CRUD de profissionais.
- CRUD de servicos.
- Criacao de agendamento com cliente externo.
- Normalizacao de WhatsApp brasileiro: usuario informa DDD + numero; banco recebe formato com `55`.
- Alteracao de status de agendamento.
- Exclusao logica de agendamento.
- Historico de agendamentos, incluindo registros excluidos.
- Snapshot de nome de servico e profissional no agendamento para preservar historico mesmo apos edicoes.
- Exportacao via impressao/PDF pelo navegador no historico.

### Mensagens Personalizaveis

- `supabase/platform_plan_catalog.sql` foi conferido no Supabase em 2026-05-15.
- `supabase/tenant_message_templates.sql` foi aplicado no Supabase.
- `tenant_message_templates` existe no banco e recebeu templates padrao idempotentes para os tenants existentes.
- Front de configuracoes do tenant passou a editar mensagens de WhatsApp compativeis com o plano atual.
- API tenant-side valida o plano antes de listar/salvar cada tipo de mensagem.
- Templates iniciais preparados:
  - `billing_reminder_due_today`;
  - `appointment_welcome`;
  - `restaurant_welcome`.

### Financeiro de Atendimentos

- Servicos da agenda passaram a aceitar duracao, descricao e valor.
- Tenants do tipo `salon` passam a reconhecer receita automaticamente quando um agendamento muda para `confirmed`.
- Receita de atendimento fica registrada em `tenant_service_revenue_events`, com snapshot de cliente, servico, profissional, valor e origem.
- Cancelamento/remarcacao para status diferente de `confirmed` estorna logicamente o evento financeiro reconhecido.
- Tela tenant-side `Financeiro de atendimentos` lista valores reconhecidos e exporta via impressao/PDF do navegador.

### Restaurante

- Tipo de negocio `restaurant` foi liberado no front e nas APIs da plataforma.
- Plano `plan4` aponta para o modulo restaurante.
- Tela tenant-side `Cardapio` criada para cadastrar grupos dinamicos e itens com nome, descricao e valor.
- Cardapio fica em `tenant_menu_groups` e `tenant_menu_items`, protegido por tenant e preparado para o workflow WhatsApp de pedidos.
- RPC `wa_restaurant_menu_grouped` retorna cardapio agrupado e texto pronto para WhatsApp, com grupos em negrito.
- Tela tenant-side `Pedidos` criada para conferir pedidos confirmados, confirmar pagamento/entrega ou cancelar pedido.
- Tela tenant-side `Pedidos pendentes` fica focada apenas nos pedidos que ainda precisam de baixa.
- Cadastro manual de pedido usa busca de itens cadastrados e carrinho com quantidades, simulando fluxo de app de delivery.
- Tela tenant-side `Financeiro de pedidos` separa o historico financeiro de pedidos pagos e cancelados.
- Pedidos ficam em `tenant_restaurant_orders` e `tenant_restaurant_order_items`.
- Baixa manual de pedido cria historico financeiro em `tenant_restaurant_order_revenue_events`.
- Cancelamento de pedido estorna logicamente a receita reconhecida.
- Inputs monetarios principais foram padronizados para exibicao e parse em formato `R$ 0,00`.

### n8n / WhatsApp

- Integracao com n8n via API confirmada usando `N8N_BASE_URL` e `N8N_API_KEY`.
- Workflow base `WA_TENANT_INBOUND_Assistant_v1` foi localizado no n8n.
- Workflow inativo `WA_TENANT_APPOINTMENTS_INBOUND_v1` foi criado no n8n com id `X1lUop6Q5fh9uxTG`.
- Workflow inativo `DAILY_APPOINTMENT_CONFIRMATION_REMINDERS` foi criado no n8n com id `zWflZZXKn2XIlHEc`.
- Workflow ativo `DAILY_BILLING_REMINDERS` foi localizado no n8n com id `YbD6NHWbgz9vLe33w_UU-`.
- Rascunho versionado em `n8n/WA_TENANT_APPOINTMENTS_INBOUND_v1.workflow.json`.
- Rascunho versionado em `n8n/DAILY_APPOINTMENT_CONFIRMATION_REMINDERS.workflow.json`.
- O novo workflow usa fluxo generico por tenant e depende de variaveis de ambiente no n8n Docker:
  - `SUPABASE_URL`;
  - `SUPABASE_SERVICE_ROLE_KEY`.
- Variaveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` foram configuradas no container n8n em 2026-05-18.
- SQL de apoio criado em `supabase/whatsapp_appointment_workflow_support.sql` para contexto, patch de conversa e criacao de agendamento via WhatsApp.
- Lembrete D-1 de agendamento foi modelado para rodar as 09h, evitar duplicidade por evento e abrir conversa de confirmacao com opcoes de confirmar/remarcar/cancelar.
- `appointment_confirmation_reminder` foi adicionado como template editavel por tenants com agenda.
- Inbound `WA_TENANT_APPOINTMENTS_INBOUND_v1` passou a tratar resposta do lembrete:
  - confirmar atualiza status para `confirmed`;
  - cancelar atualiza status para `cancelled`;
  - remarcar sugere novos horarios e atualiza `starts_at`/`ends_at`.
- Sugestao de horarios foi modelada por RPC para retornar poucas opcoes por vez dentro de 60 dias, com comando `mais` para paginar.
- Menu de servicos e profissionais do WhatsApp e dinamico: o workflow carrega `tenant_services` e `tenant_staff_members` ativos do tenant a cada conversa, conforme configurado no front.
- O workflow remoto `DAILY_BILLING_REMINDERS` passou a usar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente do n8n, em vez de credenciais fixas nos nos HTTP.
- O no de renderizacao de cobranca do `DAILY_BILLING_REMINDERS` passou a usar `template_content` retornado pelo Supabase, mantendo a mensagem editavel por tenant.
- SQL de apoio criado em `supabase/whatsapp_billing_workflow_support.sql` para geracao idempotente de ciclos mensais, listagem de ciclos vencidos e baixa de lembrete enviado.
- Validacao controlada de cobranca mensal em 2026-05-18 criou cliente/perfil/ciclo de teste em tenant `plan3`; o ciclo foi criado corretamente como vencido, mas o RPC remoto antigo ainda nao o listou. Aplicar `supabase/whatsapp_billing_workflow_support.sql` antes de considerar o workflow mensal validado ponta a ponta.
- Testes controlados sem WhatsApp real passaram em 2026-05-18:
  - inbound criou agendamento via webhook real do n8n usando envs do container;
  - lembrete D-1 listou agendamento de amanha e abriu conversa em `appointment_confirmation_action`;
  - resposta `1` confirmou agendamento e mudou status para `confirmed`;
  - resposta `2` iniciou remarcacao, sugeriu horarios e aplicou novo `starts_at`/`ends_at`;
  - workflow remoto foi mantido inativo apos os testes.
- Ajustes feitos durante os testes:
  - `webhookId` estavel adicionado ao workflow inbound para registrar webhook de producao;
  - renderizacao de slots ajustada para ler multiplos itens do n8n com `$input.all()`;
  - criacao de agendamento ajustada para aceitar resposta escalar/texto do PostgREST;
  - `wa_appointment_load_or_create_context` corrigida para evitar ambiguidade de coluna `step`.

## Modelo de Historico

### Historico de Agendamentos

- `appointments` guarda o agendamento atual e `deleted_at` para exclusao logica.
- `appointment_status_events` guarda mudancas de status.
- `admin_list_appointment_history` retorna historico consolidado com snapshots.
- Servicos e profissionais usam `is_active = false` em vez de hard delete.

### Historico de Pagamentos da Plataforma

- `payments` guarda pagamentos da plataforma.
- `platform_payment_events` guarda confirmacoes manuais, exclusoes e eventos de billing profile.
- Exclusao de tenant grava evento `tenant_deleted` com snapshot antes de apagar o tenant.
- Pagamentos excluidos sao marcados como `deleted`, nao removidos fisicamente.

### Historico de Pagamentos do Tenant

- `billing_cycles` guarda os ciclos de cobranca dos clientes/alunos.
- `tenant_payment_events` guarda confirmacao manual e pausa/ativacao de cobranca.
- Ciclo inicial de cliente/aluno e criado por `admin_create_initial_customer_billing_cycle`.
- O status tecnico `overdue` aparece no front como `Pendente`.

## Fluxo Idempotente

Principios adotados:

- Funcoes SQL usam `create or replace function` e `create table if not exists` quando aplicavel.
- Indices usam `create index if not exists`.
- Alteracoes de schema usam `add column if not exists`.
- Ciclo inicial de cobranca do cliente/aluno busca ciclo existente do mesmo perfil/mes antes de criar outro.
- Confirmacoes manuais registram evento separado da mudanca de status para manter trilha de auditoria.
- Soft delete evita perda acidental de historico visivel no contexto certo.
- Snapshot antes de hard delete do tenant evita que a plataforma perca memoria operacional do cliente excluido.
- Catalogo de planos deve ser aplicado com upsert idempotente; mudancas de nome/descricao/capacidade nao devem destruir valores individuais ja configurados para tenants.

Risco conhecido: scripts SQL soltos sao bons para desenvolvimento, mas devem virar migrations ordenadas antes de producao. Eles nao trazem problema relevante de memoria no projeto local; o problema futuro e organizacao, rastreabilidade e ordem de aplicacao.

## Seguranca e RLS

Decisoes ja aplicadas:

- RLS habilitado nas tabelas reais do schema `public`.
- Views sao tratadas com grants, sem `enable row level security`.
- `anon` teve acesso geral revogado, com excecoes explicitas como leitura de planos quando necessario.
- `authenticated` recebe grants apenas onde o app precisa acessar via Data API.
- Operacoes sensiveis passam por APIs server-side com service role e validacao de tenant/platform admin.
- Historicos internos de tenant so podem ser lidos por usuarios daquele tenant.
- Historico de plataforma nao e aberto ao tenant.

Validacoes recomendadas no Supabase:

- Rodar Security Advisor apos cada novo conjunto de tabelas.
- Verificar erros `42501` no PostgREST apos criacao de novas tabelas.
- Garantir grants explicitos em toda nova tabela antes das datas de mudanca da Supabase.
- Revisar se novas policies usam sempre vinculo por `tenant_users.auth_user_id = auth.uid()`.

## Politica de Exclusao

- Excluir pagamento da plataforma: soft delete.
- Excluir agendamento: soft delete.
- Excluir servico/profissional: desativacao por `is_active = false`.
- Excluir cliente/aluno do tenant: hoje usamos desativacao; manter assim para preservar cobranca/historico local.
- Excluir tenant: hard delete dos dados internos do tenant, mas antes grava snapshot em `platform_payment_events` para manter rastro no historico da plataforma.

Premissa importante: ao excluir tenant, os historicos internos dele podem sumir. O que nao pode sumir e o registro de plataforma dizendo que aquele tenant existiu e foi excluido.

## Arquivos SQL Aplicados/Usados

- `supabase/security_hardening_rls.sql`
- `supabase/public_data_api_grants.sql`
- `supabase/appointment_brazil_whatsapp_normalization.sql`
- `supabase/appointments_status_history_and_delete.sql`
- `supabase/appointment_history_query.sql`
- `supabase/platform_payment_history.sql`
- `supabase/tenant_payment_history.sql`
- `supabase/initial_pending_payments.sql`
- `supabase/appointment_history_snapshots.sql`
- `supabase/platform_plan_catalog.sql`
- `supabase/tenant_message_templates.sql`
- `supabase/whatsapp_appointment_workflow_support.sql`
- `supabase/whatsapp_billing_workflow_support.sql`
- `supabase/platform_plan4_constraints.sql`
- `supabase/salon_service_revenue.sql`
- `supabase/restaurant_menu.sql`
- `supabase/restaurant_menu_groups_and_orders.sql`

Antes de producao, consolidar em migrations numeradas, por exemplo:

- `001_initial_schema.sql`
- `002_security_hardening.sql`
- `003_appointments.sql`
- `004_payment_history.sql`
- `005_initial_pending_cycles.sql`

## Validacao Recomendada Agora

Fluxo plataforma:

1. Criar tenant novo.
2. Confirmar que aparece pagamento pendente da plataforma.
3. Alterar plano e valor mensal.
4. Confirmar que agenda aparece para `plan2` e `plan3`, mas nao para `plan1`.
5. Confirmar pagamento pendente.
6. Conferir historico da plataforma.
7. Excluir tenant.
8. Conferir se o historico da plataforma ainda mostra snapshot/evento de exclusao.

Fluxo tenant:

1. Entrar como tenant `plan1` e confirmar que cobrancas/alunos aparecem e agenda nao aparece.
2. Entrar como tenant `plan2` e confirmar que agenda aparece e cobrancas/alunos nao aparecem.
3. Entrar como tenant `plan3` e confirmar que cobrancas/alunos e agenda aparecem.
4. Entrar como tenant `plan4` e confirmar que apenas configuracoes basicas aparecem ate o modulo restaurante ser implementado.
5. Criar cliente/aluno em tenant com cobranca.
6. Confirmar que ele aparece em pagamentos pendentes como `Pendente`.
7. Confirmar pagamento.
8. Verificar historico de pagamentos.
9. Pausar e reativar cobranca.
10. Confirmar eventos no historico.

Fluxo agenda:

1. Criar profissional.
2. Criar servico.
3. Criar agendamento.
4. Alterar status.
5. Excluir agendamento.
6. Conferir historico de agendamentos.
7. Usar exportacao PDF/impressao.

## Proximos Passos de Produto

1. Revisao final dos fluxos principais apos os ajustes recentes.
2. Escolher provedor WhatsApp real e criar camada/adaptador de envio para nao acoplar o produto ao provedor.
3. Trocar os nos mock de envio WhatsApp pelo adaptador/provedor real.
4. Ativar webhook de agendamento somente para go-live controlado com tenant `plan2` ou `plan3`.
5. Manter um unico workflow por tipo de modulo, nao um workflow por tenant. O workflow deve buscar tenant, plano, templates e dados no Supabase.
6. Aplicar `supabase/platform_plan4_constraints.sql`, `supabase/salon_service_revenue.sql`, `supabase/restaurant_menu.sql` e `supabase/restaurant_menu_groups_and_orders.sql` no Supabase se ainda nao estiverem aplicados no ambiente alvo.
7. Testar troca de plano para `plan4` e criacao de tenant restaurante.
8. Testar cardapio tenant-side em tenant `plan4`, incluindo grupos dinamicos.
9. Testar pedidos tenant-side em tenant `plan4`, incluindo baixa manual e cancelamento.
10. Testar financeiro de atendimentos com tenant `salon` em plano com agenda.
11. Para restaurantes, planejar workflow WhatsApp separado do fluxo de agenda/cobranca, usando `tenant_menu_groups`, `tenant_menu_items` e `tenant_restaurant_orders`.
12. Quando a cadeia WhatsApp + front estiver funcionando ponta a ponta, iniciar integracao de pagamentos:
   - QR Code Pix para pedidos de restaurante;
   - QR Code Pix para cobrancas mensais de alunos/clientes;
   - pagamento por cartao de credito;
   - conciliacao automatica entre provedor de pagamento, pedido/cobranca e historico financeiro.
13. Implementar confirmacao Asaas/QR code para pagamentos da plataforma.
14. Depois implementar Asaas/QR code para cobrancas dos clientes dos tenants.
15. Transformar SQL solto em migrations ordenadas.
16. Criar checklist de release/deploy.
17. Definir provedor/deploy da aplicacao.
18. Fazer teste multi-tenant com usuarios reais separados.
19. Preparar backups e politica de retencao.
20. Rotacionar credenciais sensiveis expostas durante configuracao/testes antes de producao.

## Decisoes para Evitar Gambiarra

- Nao confiar em regra visual do front para seguranca; regras sensiveis ficam no backend/RLS.
- Nao apagar historico importante sem snapshot.
- Nao depender de texto do front para status de negocio; front so traduz status tecnico.
- Nao duplicar ciclo de cobranca se ja existe ciclo do mesmo periodo/perfil.
- Nao misturar historico de plataforma com historico interno do tenant.
- Nao permitir funcionalidades por esconder botao apenas; rotas/API tambem validam capacidades do plano.
- Nao criar um workflow n8n por tenant/restaurante; usar workflows genericos orientados por dados e configuracoes do tenant.
- Nao hardcodar mensagens de WhatsApp no workflow quando elas forem parte da experiencia do tenant; buscar templates/configuracoes no banco.
- Nao tratar SQL solto como produto final; ele e etapa de desenvolvimento antes das migrations.

## Prompt Para Continuar em Outra Task

```text
Boa tarde, Codex. Estamos no projeto `c:\Users\Jamys\billing-app`.

Contexto rapido:
- Produto: SaaS multi-tenant de cobranca, clientes/alunos e agenda.
- Plataforma gerencia tenants, planos, cobrancas e historico da plataforma.
- Tenant gerencia clientes/alunos, grupos/turmas, cobrancas, agenda e historicos proprios.
- Agenda deve existir para planos com capacidade de agenda (`plan2` e `plan3`).
- Planos agora sao por capacidade:
  - plan1: cobrancas mensais via WhatsApp e controle de alunos/clientes no site.
  - plan2: agendamento via WhatsApp e controle de agendamentos no site.
  - plan3: soma do plan1 e plan2.
  - plan4: restaurantes, modulo futuro com cardapio no site e workflow WhatsApp separado.
- Criacao de tenant gera pagamento pendente da plataforma.
- Criacao de cliente/aluno gera ciclo pendente para o tenant.
- Historicos ja existem para agendamentos, pagamentos da plataforma e pagamentos do tenant.
- Exclusao de tenant deve apagar dados internos dele, mas preservar snapshot/evento no historico da plataforma.
- SQLs estao em `supabase/`, mas antes de producao precisamos consolidar em migrations ordenadas.
- Leia `PROJECT_TRACKING.md` antes de mexer, porque ele registra decisoes, premissas e proximos passos.

Proxima prioridade:
1. Revisar os fluxos principais ponta a ponta, principalmente plano 1, 2, 3 e 4.
2. Rodar/aplicar `supabase/platform_plan_catalog.sql` se ainda nao foi aplicado.
3. Iniciar configuracoes de mensagens personalizaveis por tenant no front/banco.
4. Depois iniciar o workflow n8n de WhatsApp para agendamento dos clientes do tenant, usando `WA_TENANT_INBOUND_Assistant_v1` como referencia.
5. Manter tudo idempotente, auditavel, seguro por tenant e sem depender apenas do front para regra de negocio.
```
