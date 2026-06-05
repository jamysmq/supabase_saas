# Billing App Tracking

Atualizado em: 2026-05-27

## Visao Geral

Este projeto e um SaaS multi-tenant para gestao de cobrancas, clientes/alunos e agenda. O produto tem dois contextos claros:

- Plataforma: nosso painel administrativo, onde gerenciamos tenants, planos, cobranca da plataforma e historico operacional.
- Tenant: painel do cliente contratante, onde ele gerencia seus proprios clientes/alunos, grupos/turmas, cobrancas, agenda e historicos.

Premissa central: o tenant e o registro solido do cliente da plataforma. Os dados operacionais dele podem ser removidos quando o tenant for excluido, mas o historico da plataforma precisa preservar um snapshot minimo da existencia e exclusao desse tenant para auditoria.

## Estado Atual

- Repositorio GitHub: `https://github.com/jamysmq/supabase_saas.git`
- App local Next.js com rotas App Router e APIs server-side usando Supabase service role quando a operacao exige controle administrativo.
- Plataforma de deploy recomendada/assumida para o app: Vercel Pro, com Supabase e n8n externos.
- Checklist de deploy definitivo criado em `docs/vercel-deploy-checklist.md`; `.env.example` lista variaveis esperadas sem segredos reais.
- Guia de configuracao Meta WhatsApp Cloud API criado em `docs/meta-whatsapp-cloud-setup.md`.
- Healthcheck publico criado em `GET /api/health` para validacao basica de deploy.
- Projeto Vercel criado com as 3 envs Supabase minimas configuradas em Production em 2026-05-21.
- Dominio `meuassistentevirtual.com.br` registrado; subdominio planejado para o SaaS: `app.meuassistentevirtual.com.br`.
- Home publica substituiu o template padrao do Next.js com pagina institucional minima, politicas em `/privacidade` e termos em `/termos`.
- DNS de `app.meuassistentevirtual.com.br` validado em 2026-05-22; `GET /api/health`, `/privacidade` e `/termos` responderam publicamente pela Vercel. Nova checagem em 2026-05-25 confirmou 200 nesses endpoints.
- Em 2026-05-27, `https://www.meuassistentevirtual.com.br` respondeu 200 com a home institucional do Assistente Jack, `https://meuassistentevirtual.com.br` redirecionou para `www`, e `https://app.meuassistentevirtual.com.br` redirecionou a raiz para `/login`.
- Em 2026-05-25, nova validacao local confirmou `NEXT_PUBLIC_SUPABASE_URL` em `.env.local` no formato esperado `https://<project-ref>.supabase.co`, sem sufixo `/rest/v1/`.
- Supabase ja possui tenants, planos, usuarios de tenant, cobrancas de clientes, pagamentos da plataforma, agendamentos, historicos e tabelas/eventos auxiliares.
- n8n ja possui workflows de onboarding/cadastro e lembretes; o fluxo tenant-side de agenda ainda sera derivado do `WA_TENANT_INBOUND_Assistant_v1`.
- Hardening inicial de RLS e grants ja foi aplicado e validado superficialmente navegando pelas telas.

## Premissas de Produto

- Plano e o pilar de disponibilidade de funcionalidades, mas a regra deve ser por capacidade do plano, nao por texto espalhado no front.
- `plan1`: cobrancas mensais via WhatsApp e controle de alunos/clientes no site.
- `plan2`: agendamento via WhatsApp e controle de agendamentos no site.
- `plan3`: soma do `plan1` e `plan2`; cobrancas, alunos/clientes e agenda.
- `plan4`: restaurantes; cardapio, pedidos, financeiro e workflow WhatsApp proprio.
- `plan5`: soma do `plan4` com agenda de mesas/reservas como feature planejada.
- Agenda fica disponivel para planos com capacidade de agenda: `plan2` e `plan3`.
- Cobrancas, alunos/clientes e turmas/grupos ficam disponiveis para planos com capacidade de cobranca mensal: `plan1` e `plan3`.
- Modelo de dados, integracoes estruturais e plataforma de hospedagem devem ser tratados como decisoes definitivas de arquitetura: mudar feature e aceitavel, mas evitar escolhas temporarias que obriguem reescrita, migracao de plataforma ou troca de modelo central depois.
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
- Tenants `salon` com agenda possuem tela `Estoque`; entrada de produto atualiza saldo e registra despesa negativa em `tenant_service_revenue_events` com origem `stock_purchase`.
- Validacao autenticada tenant-side de financeiro de atendimentos passou em 2026-05-20: usuario temporario em tenant `plan2`/`salon` criou servico com valor, profissional e agendamento; confirmacao reconheceu receita de atendimento, cancelamento estornou logicamente a receita, e tenant/usuario de teste foram removidos ao final.

### Restaurante

- Tipo de negocio `restaurant` foi liberado no front e nas APIs da plataforma.
- Planos `plan4` e `plan5` apontam para o modulo restaurante.
- `plan5` foi preparado como restaurante avancado em 2026-05-20: herda as funcionalidades do `plan4`, mas agenda de mesas/reservas fica como feature futura, sem expor tela incompleta.
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
- Workflow inativo `DAILY_TENANT_AGENDA_REMINDERS` foi criado no n8n com id `dcKARQX6GDCBPo3W`.
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
- Inbound `WA_TENANT_APPOINTMENTS_INBOUND_v1` passou a abrir com menu de agenda: agendar, remarcar ou cancelar. Remarcacao/cancelamento usam os proximos agendamentos do WhatsApp e confirmam identidade por data de nascimento quando disponivel.
- Lembrete diario tenant-side de agenda foi criado em `DAILY_TENANT_AGENDA_REMINDERS`: a cada 15 minutos busca tenants cujo expediente inicia em 30 minutos e envia resumo dos agendamentos do dia para o WhatsApp do tenant.
- O workflow remoto `DAILY_BILLING_REMINDERS` passou a usar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente do n8n, em vez de credenciais fixas nos nos HTTP.
- O no de renderizacao de cobranca do `DAILY_BILLING_REMINDERS` passou a usar `template_content` retornado pelo Supabase, mantendo a mensagem editavel por tenant.
- SQL de apoio criado em `supabase/whatsapp_billing_workflow_support.sql` para geracao idempotente de ciclos mensais, listagem de ciclos vencidos e baixa de lembrete enviado.
- Validacao controlada de cobranca mensal em 2026-05-18 passou apos aplicar `supabase/whatsapp_billing_workflow_support.sql`:
  - cliente/perfil/ciclo de teste em tenant `plan3` foi listado como vencido;
  - template de cobranca veio de `tenant_message_templates`;
  - mensagem foi renderizada com nome, valor, vencimento e Pix;
  - ciclo recebeu `message_rendered` e `message_sent_at`;
  - gerador mensal criou ciclo novo para perfil sem ciclo no mes;
  - listagem de vencidos ficou vazia apos a baixa do lembrete.
- Provedor WhatsApp escolhido em 2026-05-20: WhatsApp Cloud API oficial da Meta.
- Adaptador inicial para WhatsApp Cloud API oficial criado em 2026-05-20:
  - biblioteca server-side em `src/lib/whatsapp-cloud.ts`;
  - endpoint interno protegido em `app/api/internal/whatsapp/send/route.ts`;
  - documentacao operacional em `docs/whatsapp-cloud-adapter.md`;
  - envio inicial cobre mensagem de texto livre via `/{phone_number_id}/messages`; templates, midias, botoes/listas e webhooks de status ficam como evolucao.
- Webhook oficial da Meta preparado em 2026-05-20:
  - `GET /api/whatsapp/webhook` verifica `hub.challenge` com `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
  - `POST /api/whatsapp/webhook` valida `x-hub-signature-256` com `WHATSAPP_APP_SECRET` e normaliza mensagens/status;
  - mensagens de texto podem ser encaminhadas ao n8n via `WHATSAPP_INBOUND_N8N_WEBHOOK_URL` e token opcional `WHATSAPP_INBOUND_N8N_TOKEN`;
  - ativacao real depende de URL publica do app, conta Meta liberada e webhook n8n final.
- Decisao de produto em 2026-05-22: handoff humano sera feito por inbox tenant-side no painel. O cliente responde ao numero oficial da plataforma; o tenant visualiza e responde pelo SaaS, com envio saindo pelo adaptador WhatsApp Cloud API.
- Decisao de produto em 2026-05-22: a inbox de WhatsApp fica disponivel para todos os tenants; as automacoes podem variar por plano, mas atendimento humano centralizado e funcionalidade transversal.
- Persona das mensagens WhatsApp definida em 2026-05-22 como `Assistente Jack`; o nome publico do numero na Meta tambem deve ser configurado como `Assistente Jack` para evitar aparecer `Meu Assistente Virtual` no WhatsApp.
- Site publico passou a apresentar `Assistente Jack` como produto da Meu Assistente Virtual em 2026-05-22, para alinhar dominio/site com o display name desejado do WhatsApp na Meta.
- Primeira camada da inbox tenant-side criada em 2026-05-22:
  - SQL versionado em `supabase/tenant_whatsapp_inbox.sql`;
  - migration `supabase/migrations/007_tenant_whatsapp_inbox.sql`;
  - webhook Meta passa a tentar registrar inbound via RPC `admin_record_whatsapp_inbound`;
  - APIs tenant-side em `app/api/tenant-whatsapp/threads`;
  - tela tenant-side `Atendimento WhatsApp` em `/whatsapp-inbox`.
  - Aplicacao no Supabase alvo ainda pendente porque a CLI Supabase/psql nao estava disponivel neste ambiente.
- Link publico de atendimento por tenant criado em 2026-05-23:
  - tabela `tenant_whatsapp_entry_links` guarda um codigo unico no formato `jack-xxxxxxxx`;
  - API tenant-side `GET /api/tenant-whatsapp/link` cria/reaproveita o codigo e retorna o link `wa.me`;
  - tela `/whatsapp-inbox` exibe o link para copiar;
  - webhook Meta passa a resolver o tenant pelo codigo na primeira mensagem antes de consultar historico/conversas existentes.
- SQLs `supabase/tenant_whatsapp_inbox.sql` e `supabase/tenant_whatsapp_entry_links.sql` foram aplicados pelo usuario no Supabase alvo antes da rodada de testes de 2026-05-25.
- Validacao controlada do roteamento por link em 2026-05-25 passou no Supabase:
  - tenant ativo foi localizado;
  - codigo `jack-xxxxxxxx` existente/criado em `tenant_whatsapp_entry_links`;
  - `admin_record_whatsapp_inbound` recebeu uma mensagem fake com o codigo;
  - thread foi criada para o tenant correto;
  - thread fake foi removida ao final, preservando apenas o codigo de entrada do tenant.
- Correcao SQL pendente em 2026-05-25: `admin_ensure_tenant_whatsapp_entry_link` foi ajustada no repositorio para trocar o nome de retorno `tenant_id` por `link_tenant_id` e evitar ambiguidade no Postgres. O ambiente local nao possui `psql`/Supabase CLI instalado; reexecutar `supabase/tenant_whatsapp_entry_links.sql` no SQL Editor para substituir a funcao aplicada caso a correcao ainda nao tenha sido aplicada no Supabase alvo.
- Templates padrao de WhatsApp atualizados para a persona `Assistente Jack`; SQL incremental criado em `supabase/tenant_message_templates_assistente_jack.sql` e migration `supabase/migrations/008_assistente_jack_message_persona.sql`.
- Inbound generico de cadastro por WhatsApp para tenants com cobranca mensal foi versionado em 2026-05-25:
  - SQL incremental `supabase/whatsapp_billing_signup_workflow_support.sql`;
  - migration `supabase/migrations/010_whatsapp_billing_signup_workflow.sql`;
  - workflow n8n inativo `n8n/WA_TENANT_BILLING_SIGNUP_INBOUND_v1.workflow.json`;
  - template editavel `billing_signup_welcome`;
  - fluxo coleta nome completo, grupo/turma opcional, valor da mensalidade e dia de vencimento;
  - cria ou reativa cliente pelo WhatsApp, cria/atualiza perfil de cobranca e gera ciclo inicial pendente.
- Front da inbox WhatsApp recebeu ajustes de configuracao de mensagens em 2026-05-27:
  - configuracao abre em modal dentro de `/whatsapp-inbox`;
  - editor usa variaveis travadas para evitar alteracao acidental do codigo;
  - variaveis continuam arrastaveis no desktop;
  - variaveis podem ser inseridas por toque no mobile no editor ativo;
  - fechar a modal com alteracoes nao salvas pede confirmacao para salvar ou sair sem salvar.
- Rascunho versionado `n8n/DAILY_APPOINTMENT_CONFIRMATION_REMINDERS.workflow.json` foi preparado para trocar o mock de envio por chamada ao endpoint interno `POST /api/internal/whatsapp/send`; importacao no n8n remoto deve aguardar deploy/app publico e envs `APP_BASE_URL` e `WHATSAPP_INTERNAL_SEND_TOKEN` no container.
- Workflow remoto `DAILY_APPOINTMENT_CONFIRMATION_REMINDERS` foi atualizado via API n8n em 2026-05-21 com o JSON versionado que usa `HTTP_send_whatsapp_text` e `$env.APP_BASE_URL`; permaneceu inativo. Ativacao ainda depende de URL publica validada, envs no container n8n e WhatsApp real liberado.
- Em 2026-05-20 foi confirmado no Supabase alvo que `plan4`, tabelas de restaurante, historico financeiro de pedidos, tabela de receita de atendimentos e RPC `wa_restaurant_menu_grouped` estao aplicados.
- SQL incremental criado em `supabase/platform_plan5_restaurant_reservations.sql` para cadastrar `plan5`, liberar constraint de assinatura e fazer o RPC de cardapio aceitar `plan4` e `plan5`.
- `supabase/platform_plan5_restaurant_reservations.sql` foi aplicado no Supabase em 2026-05-20.
- Validacao controlada do `plan5` passou em 2026-05-20: plano aparece ativo no catalogo, tenant restaurante alternado temporariamente para `plan5` continuou acessando `wa_restaurant_menu_grouped`, e tenant foi restaurado para `plan4`.
- Validacao controlada de tenant `plan5` passou em 2026-05-20: tenant restaurante temporario criou grupo/item de cardapio, RPC incluiu o item, pedido foi criado, baixa financeira reconheceu receita, cancelamento estornou a receita e o tenant de teste foi removido ao final.
- Validacao autenticada tenant-side de restaurante `plan5` passou em 2026-05-20: usuario temporario acessou APIs do app, criou grupo/item de cardapio, criou pedido com carrinho, listou pedido confirmado, confirmou pagamento Pix, gerou receita reconhecida e cancelou pedido com estorno logico da receita; tenant e usuario de teste foram removidos ao final.
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

Migrations consolidadas criadas em 2026-05-21:

- `supabase/migrations/001_platform_core.sql`
- `supabase/migrations/002_billing_and_payment_history.sql`
- `supabase/migrations/003_appointments_and_service_revenue.sql`
- `supabase/migrations/004_message_templates_and_whatsapp_appointments.sql`
- `supabase/migrations/005_restaurant_and_plan5.sql`
- `supabase/migrations/006_security_and_grants.sql`
- `supabase/migrations/007_tenant_whatsapp_inbox.sql`
- `supabase/migrations/008_assistente_jack_message_persona.sql`
- `supabase/migrations/009_tenant_whatsapp_entry_links.sql`
- `supabase/migrations/010_whatsapp_billing_signup_workflow.sql`
- `supabase/migrations/README.md`

Observacao: as migrations consolidam os SQLs incrementais existentes no repositorio. Elas ainda nao substituem um dump/baseline completo de banco novo, porque parte do schema base foi criada antes dos SQLs soltos atuais. Proximo passo seguro antes de producao: aplicar em staging e comparar schema/dados essenciais com o Supabase alvo.

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
- `supabase/tenant_whatsapp_inbox.sql`
- `supabase/tenant_whatsapp_entry_links.sql`
- `supabase/tenant_message_templates_assistente_jack.sql`
- `supabase/whatsapp_billing_signup_workflow_support.sql`
- `supabase/platform_plan4_constraints.sql`
- `supabase/platform_plan5_restaurant_reservations.sql`
- `supabase/salon_service_revenue.sql`
- `supabase/restaurant_menu.sql`
- `supabase/restaurant_menu_groups_and_orders.sql`

Arquivo diagnostico mantido fora da ordem de aplicacao:

- `supabase/tenant_plan_feature_trigger_diagnostic.sql`

## Validacao Recomendada Agora

Validacao tecnica local executada em 2026-05-25:

- `npm run lint` passou.
- `npm run build` passou.
- JSONs versionados do n8n em `n8n/WA_TENANT_APPOINTMENTS_INBOUND_v1.workflow.json` e `n8n/DAILY_APPOINTMENT_CONFIRMATION_REMINDERS.workflow.json` foram parseados com sucesso.
- `GET https://app.meuassistentevirtual.com.br/api/health` respondeu 200.
- `.env.local` local usa `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`, sem `/rest/v1/`.

Validacao tecnica local/publica executada em 2026-05-27:

- `npm run lint` passou.
- `npm run build` passou.
- JSONs versionados do n8n em `n8n/DAILY_APPOINTMENT_CONFIRMATION_REMINDERS.workflow.json`, `n8n/WA_TENANT_APPOINTMENTS_INBOUND_v1.workflow.json` e `n8n/WA_TENANT_BILLING_SIGNUP_INBOUND_v1.workflow.json` foram parseados com sucesso.
- `GET https://app.meuassistentevirtual.com.br/api/health` respondeu 200.
- `HEAD https://app.meuassistentevirtual.com.br/privacidade` respondeu 200.
- `HEAD https://app.meuassistentevirtual.com.br/termos` respondeu 200.
- `HEAD https://www.meuassistentevirtual.com.br` respondeu 200.
- `HEAD https://meuassistentevirtual.com.br` respondeu 307 para `https://www.meuassistentevirtual.com.br/`.
- `GET -L https://meuassistentevirtual.com.br/` entregou a home institucional com `Assistente Jack`, `jack-hero.svg` e meta tag de verificacao do Facebook.
- `HEAD https://app.meuassistentevirtual.com.br/` respondeu 307 para `/login`.
- `HEAD https://app.meuassistentevirtual.com.br/login` respondeu 200.
- Endpoints protegidos sem credenciais responderam como esperado:
  - `HEAD /api/tenant-whatsapp/link`: 401;
  - `GET /api/whatsapp/webhook` sem token valido: 403;
  - `POST /api/internal/whatsapp/send` sem token interno: 401.
- `npm audit --audit-level=moderate` encontrou 4 vulnerabilidades: `next` high, `postcss` moderate, `brace-expansion` moderate e `ws` moderate. Tratar em tarefa separada com update controlado.
- Supabase CLI local instalada via pacote do projeto travou em timeout tanto via `npx supabase --version` quanto via binario direto. Para aplicacoes SQL imediatas, seguir usando SQL Editor do Supabase ou investigar a CLI antes de depender dela.
- Relatorio completo salvo em `docs/validation-2026-05-27.md`.

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
4. Entrar como tenant `plan4` e confirmar que restaurante aparece, mas cobrancas/alunos e agenda nao aparecem.
5. Entrar como tenant `plan5` e confirmar que restaurante aparece como no `plan4`; agenda de mesas/reservas fica planejada para feature futura.
6. Criar cliente/aluno em tenant com cobranca.
7. Confirmar que ele aparece em pagamentos pendentes como `Pendente`.
8. Confirmar pagamento.
9. Verificar historico de pagamentos.
10. Pausar e reativar cobranca.
11. Confirmar eventos no historico.

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
2. Configurar credenciais reais da WhatsApp Cloud API no ambiente de deploy/app:
   - `WHATSAPP_CLOUD_ACCESS_TOKEN`;
   - `WHATSAPP_CLOUD_PHONE_NUMBER_ID`;
   - `WHATSAPP_CLOUD_GRAPH_VERSION`;
   - `WHATSAPP_PUBLIC_PHONE_E164`;
   - `WHATSAPP_INTERNAL_SEND_TOKEN`;
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
   - `WHATSAPP_APP_SECRET`;
   - `WHATSAPP_INBOUND_N8N_WEBHOOK_URL`;
   - `WHATSAPP_INBOUND_N8N_TOKEN`.
3. Definir URL publica do app e configurar no n8n:
   - `APP_BASE_URL`;
   - `WHATSAPP_INTERNAL_SEND_TOKEN`.
4. Conectar tambem `meuassistentevirtual.com.br`/`www` na Vercel se quiser separar site institucional do subdominio do app.
5. Voltar para verificacao/configuracao Meta usando `https://app.meuassistentevirtual.com.br` como URL publica ja validada.
6. Configurar no container n8n:
   - `APP_BASE_URL=https://app.meuassistentevirtual.com.br`;
   - `WHATSAPP_INTERNAL_SEND_TOKEN`.
7. Ativar webhook de agendamento somente para go-live controlado com tenant `plan2` ou `plan3`.
8. Manter um unico workflow por tipo de modulo, nao um workflow por tenant. O workflow deve buscar tenant, plano, templates e dados no Supabase.
9. Para restaurantes, planejar workflow WhatsApp separado do fluxo de agenda/cobranca, usando `tenant_menu_groups`, `tenant_menu_items` e `tenant_restaurant_orders`.
10. Planejar agenda de mesas/reservas para `plan5`, com tabelas e workflow proprios, sem reaproveitar a agenda de servicos de salao/clinica.
11. Quando a cadeia WhatsApp + front estiver funcionando ponta a ponta, iniciar integracao de pagamentos:
   - QR Code Pix para pedidos de restaurante;
   - QR Code Pix para cobrancas mensais de alunos/clientes;
   - pagamento por cartao de credito;
   - conciliacao automatica entre provedor de pagamento, pedido/cobranca e historico financeiro.
12. Implementar confirmacao Asaas/QR code para pagamentos da plataforma.
13. Depois implementar Asaas/QR code para cobrancas dos clientes dos tenants.
14. Aplicar migrations consolidadas em staging e comparar schema/dados essenciais com o Supabase alvo.
15. Executar checklist de release/deploy da Vercel em `docs/vercel-deploy-checklist.md`.
16. Configurar WhatsApp Cloud API seguindo `docs/meta-whatsapp-cloud-setup.md`.
17. Fazer teste multi-tenant com usuarios reais separados.
18. Preparar backups e politica de retencao.
19. Rotacionar credenciais sensiveis expostas durante configuracao/testes antes de producao.
20. `.env.local` local ja foi conferido em 2026-05-25 e usa `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`, sem o sufixo `/rest/v1/`.
21. Tratar vulnerabilidades apontadas pelo `npm audit` de 2026-05-27 com atualizacao controlada de dependencias e nova rodada de lint/build.

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

Antes de mexer, leia `PROJECT_TRACKING.md`.

Estado atual:
- Produto SaaS multi-tenant para cobrancas, clientes/alunos, agenda e restaurante.
- Planos:
  - plan1: cobrancas mensais via WhatsApp + alunos/clientes no site.
  - plan2: agenda via WhatsApp + agendamentos no site.
  - plan3: plan1 + plan2.
  - plan4: restaurante com cardapio, pedidos e financeiro.
  - plan5: plan4 + agenda de mesas/reservas como feature futura.
- Regras de plano devem ser validadas no front e nas APIs, nunca so escondendo botao.
- Modelo de dados, integracoes estruturais e plataforma de hospedagem devem ser tratados como decisoes definitivas de arquitetura.
- Vercel Pro foi assumida como plataforma do app; Supabase e n8n seguem externos.
- `.env.example`, `docs/vercel-deploy-checklist.md` e `GET /api/health` ja existem.
- Adaptador WhatsApp Cloud API oficial ja existe:
  - `src/lib/whatsapp-cloud.ts`;
  - `app/api/internal/whatsapp/send/route.ts`;
  - `app/api/whatsapp/webhook/route.ts`;
  - `src/lib/whatsapp-webhook.ts`;
  - `docs/whatsapp-cloud-adapter.md`.
- Guia Meta criado em `docs/meta-whatsapp-cloud-setup.md`.
- Migrations consolidadas foram criadas em `supabase/migrations/`, mas ainda precisam ser aplicadas em staging e comparadas com o Supabase alvo.
- SQLs de inbox/link WhatsApp foram aplicados no Supabase alvo pelo usuario em 2026-05-25, mas `supabase/tenant_whatsapp_entry_links.sql` precisa ser reexecutado apos a correcao da funcao `admin_ensure_tenant_whatsapp_entry_link`.
- O arquivo `supabase/tenant_plan_feature_trigger_diagnostic.sql` e diagnostico e ficou fora da ordem de aplicacao.
- Workflows n8n versionados continuam genericos; nao criar workflow por tenant.

Proxima prioridade:
1. Reexecutar `supabase/tenant_whatsapp_entry_links.sql` no Supabase para aplicar a correcao da funcao `admin_ensure_tenant_whatsapp_entry_link`.
2. Criar/configurar app Meta WhatsApp Cloud API seguindo `docs/meta-whatsapp-cloud-setup.md`.
3. Configurar envs reais na Vercel e no n8n somente via ambiente, sem colar segredos no chat.
4. Aplicar migrations consolidadas em staging e comparar schema/dados essenciais com o Supabase alvo.
5. Depois testar WhatsApp real:
   - challenge do webhook Meta;
   - mensagem inbound real;
   - envio pelo endpoint interno;
   - fluxo de agendamento em tenant plan2 ou plan3.
5. Manter tudo idempotente, auditavel, seguro por tenant e sem depender apenas do front para regra de negocio.
```
