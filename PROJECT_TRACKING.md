# Billing App Tracking

Atualizado em: 2026-07-18

Roadmap operacional até a conclusão: docs/ROADMAP_CONCLUSAO.md.

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
- O catálogo de planos da plataforma é a fonte de verdade do valor-base; alterações de preço propagam para todos os tenants vinculados e substituem ajustes individuais.
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
- Card publico `Falar conosco` envia mensagens para o admin da plataforma; mensagens ficam em `platform_contact_messages` e podem ser lidas/arquivadas em `/platform/contact-messages`.

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
- Bloqueios temporarios de agenda por intervalo continuo foram adicionados em 2026-07-14: o tenant pode fechar de uma data/hora ate outra, inclusive atravessando dias.
- A regra de bloqueio e central no banco: painel, WhatsApp e remarcacoes nao aceitam novos horarios no intervalo, enquanto agendamentos existentes permanecem preservados.

### Mensagens do WhatsApp

- As mensagens operacionais são controladas pelo produto para preservar identidade, conformidade e compatibilidade com os templates oficiais da Meta.
- Os editores de mensagens foram removidos do painel; o tenant não personaliza cadastro, cobrança ou notificações de agenda.
- `tenant_message_templates` permanece como configuração interna e histórico de compatibilidade, sem exposição para edição pelo tenant.
- Fora da janela de atendimento da Meta, mensagens proativas usam templates oficiais; dentro da janela, o app pode usar o texto equivalente controlado pelo produto.
- O cadastro pelo WhatsApp usa apresentação fixa do Assistente Jack e somente os dados do negócio são interpolados.

### Financeiro de Atendimentos

- Servicos da agenda passaram a aceitar duracao, descricao e valor.
- Tenants do tipo `salon` reconhecem receita somente quando o atendimento já terminou e o tenant o marca explicitamente como `completed`.
- Receita de atendimento fica registrada em `tenant_service_revenue_events`, com snapshot de cliente, servico, profissional, valor e origem.
- Agendamentos encerrados em `scheduled` ou `confirmed` entram numa fila de confirmação do resultado; `confirmed`, `cancelled` e `no_show` não geram receita.
- Mudança de um atendimento concluído para outro status estorna logicamente o evento financeiro reconhecido.
- Tela tenant-side `Financeiro de atendimentos` lista valores reconhecidos e exporta via impressao/PDF do navegador.
- Tenants `salon` com agenda possuem tela `Estoque`; entrada de produto atualiza saldo e registra despesa negativa em `tenant_service_revenue_events` com origem `stock_purchase`.
- A migration 047 corrigiu os lançamentos antigos baseados em confirmação e criou a fila pós-atendimento.
- A migration 048 torna atômica a atualização feita pelo painel: status, histórico e receita confirmam juntos ou são integralmente revertidos.
- A mesma migration restringe as RPCs internas de sugestão de horários ao `service_role`, removendo o acesso autenticado legado com `tenant_id` arbitrário.
- Migration 048 aplicada no Supabase alvo em 2026-07-17 e validada sem mutação: repetir o status atual não criou evento nem receita, e execução anônima foi recusada com `42501`.
- Validação funcional temporária da migration 048 concluída no Salão de Beleza: dois agendamentos encerrados entraram na fila; `completed` criou evento e receita reconhecida; `no_show` criou apenas o evento; ambos saíram da fila e todos os registros técnicos foram removidos ao final.
- A migration 049 foi aplicada e verificada no Supabase alvo em 2026-07-18: novas colunas, tabela de auditoria e RPCs responderam corretamente; a regra permite correções de status em agendamentos antigos cujo dia saiu do expediente, mantendo os dias úteis para criação, remarcação e restauração.
- A mesma migration impede `completed` e `no_show` antes do horário final do atendimento.
- Validação oficial no Salão de Beleza confirmou eventos com origem `panel`: atendimentos `completed` mantiveram receita reconhecida, enquanto `no_show` não manteve receita ativa; os dois agendamentos de sábado também ficaram com histórico auditável de alteração/cancelamento.

### Profissionais adicionais de salões

- Planos 2 e 3 incluem um profissional para tenants do tipo `salon`.
- Cada profissional ativo adicional acrescenta R$ 25,00 à mensalidade.
- A inclusão adicional gera solicitação para a Soft Ink; o profissional só é criado após aprovação da plataforma.
- Alterações de profissional, plano ou preço-base recalculam a composição do perfil de cobrança.
- A inclusão adicional foi validada de ponta a ponta no Salão de Beleza, incluindo aprovação, liberação e acréscimo de R$ 25,00.
- A exclusão é definitiva, preserva snapshots nos históricos e fica auditada para a Soft Ink.
- Profissionais com agendamentos futuros só podem ser excluídos depois que esses horários forem movidos ou cancelados.
- Até 15 dias de atividade, o adicional não entra na próxima mensalidade; acima de 15 dias, cobra-se uma última parcela de R$ 25,00 e depois o valor recorrente é removido.
- Em 2026-07-19, o agendamento futuro ligado ao registro legado de Ingrid Dayene foi cancelado pelo fluxo auditado do painel e a profissional foi excluída pela RPC oficial. O histórico preservou o snapshot do nome e o evento de remoção registrou 46 dias ativos e uma única cobrança final de R$ 25,00.
- A operação revelou um alias inválido (`pp`) introduzido na função de recálculo pela migration 049. A migration 054 corrigiu a referência para `plan`, passou em prévia sob `ROLLBACK` e foi aplicada em produção antes da exclusão.
- Após a remoção, o perfil do Salão de Beleza ficou com base de R$ 49,90, quatro adicionais recorrentes (R$ 100,00), um adicional final pendente (R$ 25,00) e total da próxima cobrança de R$ 174,90.

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

### Generalizacao Catalogo + Pedidos (2026-06-26)

- O modulo "restaurante" foi generalizado para um motor de **catalogo + pedidos** reaproveitavel por outros tipos de negocio de varejo.
- Decisao de escopo: generalizamos a camada de app + rotas, mantendo os nomes fisicos das tabelas e RPCs no banco (`tenant_menu_*`, `tenant_restaurant_orders`, `wa_restaurant_menu_grouped`). Limpeza fisica do banco fica como migration dedicada futura.
- Capability nova `tenantCanUseCatalog` (planos 4/5); `tenantCanUseRestaurant` mantido como alias retrocompativel para rotas/templates antigos.
- Novos tipos de negocio adicionados ao motor de catalogo: `loja_material` (loja de material de construcao) e `petshop`, ambos compativeis com `plan4`/`plan5`.
- Vocabulario por tipo de negocio em `src/lib/business-labels.ts` via `getCatalogLabels`: restaurante usa "Cardapio/itens"; demais varejos usam "Catalogo/produtos".
- Rotas de API renomeadas: `/api/restaurant/*` -> `/api/catalog/*` (mesma logica, mesmas tabelas).
- Telas renomeadas/generalizadas: `/restaurant-menu` -> `/catalogo`, `/restaurant-orders` -> `/pedidos`.
- Financeiro unificado em `/financeiro`: junta receita de pedidos, atendimentos e despesas de estoque numa unica tela, com filtro de periodo, resumo por dia, exportacao CSV e PDF. As telas antigas `/restaurant-finance` e `/service-revenue` foram removidas (a API `/api/service-revenue` continua existindo como fonte de dados).
- Plataforma e cadastro publico passaram a listar os novos tipos de negocio.

### Estoque transversal (2026-07-20)

- O estoque originalmente criado para salões foi generalizado para Salão e tenants dos Planos 4 e 5. As tabelas físicas `tenant_salon_inventory_*` foram preservadas para não mover nem duplicar dados de produção.
- A capability `tenantCanUseInventory`, a tela `/inventory` e a API `/api/inventory` formam o contrato genérico; `/salon-inventory` e `/api/salon-inventory` permanecem retrocompatíveis.
- A migration 055 adicionou ator, origem e chave de idempotência aos movimentos, além de RPCs transacionais para compra e saída. As funções usam travas no banco, custo médio e constraint de saldo não negativo.
- Compras continuam gerando despesa `stock_purchase` no financeiro unificado. A API financeira foi liberada para tenants de catálogo, permitindo que despesas dos Planos 4 e 5 apareçam junto ao financeiro de pedidos.
- A prévia em produção sob `ROLLBACK` validou Salão e Plano 4, repetição idempotente e rejeição de saída acima do saldo. A migration foi aplicada sem alterar os dois produtos reais já existentes no Salão de Beleza.
- A integração entre item de catálogo e produto de estoque será feita no fluxo de confirmação do pedido; não haverá um segundo saldo específico para pedidos.

### n8n / WhatsApp

- Integracao com n8n via API confirmada usando `N8N_BASE_URL` e `N8N_API_KEY`.
- Workflow base `WA_TENANT_INBOUND_Assistant_v1` foi localizado no n8n.
- Workflow inativo `WA_TENANT_APPOINTMENTS_INBOUND_v1` foi criado no n8n com id `X1lUop6Q5fh9uxTG`.
- Workflow inativo `DAILY_APPOINTMENT_CONFIRMATION_REMINDERS` foi criado no n8n com id `zWflZZXKn2XIlHEc`.
- Workflow ativo `DAILY_TENANT_AGENDA_REMINDERS` está no n8n com id `dcKARQX6GDCBPo3W`.
- Workflow ativo `DAILY_BILLING_REMINDERS` foi localizado no n8n com id `YbD6NHWbgz9vLe33w_UU-`.
- Rascunho versionado em `n8n/WA_TENANT_APPOINTMENTS_INBOUND_v1.workflow.json`.
- Rascunho versionado em `n8n/DAILY_APPOINTMENT_CONFIRMATION_REMINDERS.workflow.json`.
- O novo workflow usa fluxo generico por tenant e depende de variaveis de ambiente no n8n Docker:
  - `SUPABASE_URL`;
  - `SUPABASE_SERVICE_ROLE_KEY`.
- Variaveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` foram configuradas no container n8n em 2026-05-18.
- SQL de apoio criado em `supabase/whatsapp_appointment_workflow_support.sql` para contexto, patch de conversa e criacao de agendamento via WhatsApp.
- Lembrete D-1 de agendamento foi modelado para rodar as 09h, evitar duplicidade por evento e abrir conversa de confirmacao com opcoes de confirmar/remarcar/cancelar.
- `appointment_confirmation_reminder` foi inicialmente criado como editável e depois passou ao controle do produto/Meta, sem editor no tenant.
- Inbound `WA_TENANT_APPOINTMENTS_INBOUND_v1` passou a tratar resposta do lembrete:
  - confirmar atualiza status para `confirmed`;
  - cancelar atualiza status para `cancelled`;
  - remarcar sugere novos horarios e atualiza `starts_at`/`ends_at`.
- Sugestao de horarios foi modelada por RPC para retornar poucas opcoes por vez dentro de 60 dias, com comando `mais` para paginar.
- Menu de servicos e profissionais do WhatsApp e dinamico: o workflow carrega `tenant_services` e `tenant_staff_members` ativos do tenant a cada conversa, conforme configurado no front.
- Inbound `WA_TENANT_APPOINTMENTS_INBOUND_v1` passou a abrir com menu de agenda: agendar, remarcar ou cancelar. Remarcacao/cancelamento usam os proximos agendamentos do WhatsApp e confirmam identidade por data de nascimento quando disponivel.
- Lembrete diario tenant-side de agenda foi criado em `DAILY_TENANT_AGENDA_REMINDERS`: a cada 15 minutos busca tenants cujo expediente inicia em 30 minutos e envia resumo dos agendamentos do dia para o WhatsApp do tenant.
- Em 2026-06-06, SQLs de apoio da agenda/lembrete diario foram reaplicados no Supabase alvo e os workflows remotos `WA_TENANT_APPOINTMENTS_INBOUND_v1` e `DAILY_TENANT_AGENDA_REMINDERS` foram atualizados no n8n mantendo status inativo.
- Em 2026-07-16, `DAILY_TENANT_AGENDA_REMINDERS` recebeu credencial Header Auth dedicada, passou a usar o dominio oficial e foi corrigido para preservar os dados do lembrete ao registrar o envio depois da resposta da Meta.
- Em 2026-07-16, o resumo diario foi disparado para o WhatsApp de teste do Salao de Beleza com dois agendamentos reais, recebido pelo usuario e registrado uma unica vez em `tenant_daily_agenda_reminder_events`; o workflow ficou ativo.
- Em 2026-07-19, a auditoria do `DAILY_BILLING_REMINDERS` explicou o envio tardio da cobrança de Novak Djokovic: execuções anteriores falharam ao criar ciclos `pending` por incompatibilidade do constraint `billing_cycles_status_chk`; quando a execução voltou a passar, o ciclo vencido entrou como backlog. Os demais ciclos que já tinham `message_sent_at` não eram elegíveis para novo envio.
- A migration `050_billing_reminder_delivery_tracking.sql` foi preparada para alinhar os status `pending`/`overdue`, reservar cada tentativa atomicamente antes do envio, limitar retentativas a três e só baixar `message_sent_at` após callback `delivered` ou `read` da Meta.
- O webhook oficial foi preparado para persistir e reconciliar callbacks de cobrança mesmo quando chegam antes do aceite, e o workflow versionado recebeu fuso `America/Fortaleza`, distinção entre vencimento do dia e atraso e reserva obrigatória antes da chamada à Meta.
- Em 2026-07-19, o template `jack_billing_overdue_reminder_v1` foi aprovado pela Meta em produção com ID `1008513205307809` e categoria `UTILITY`.
- A migration 050 foi aplicada no Supabase de produção em 2026-07-19 e verificada quanto a constraint, tabelas, RPCs e permissões; o rollout do app e do workflow seguiu somente após essas confirmações.
- O app revisado foi publicado na Vercel em produção pelo deployment `dpl_6Cmtrn914MbUsNkZxj3PBReK6xwV`; healthcheck respondeu `ok` e a rota do webhook recusou acesso não autenticado com 403.
- O workflow oficial foi atualizado, reativado com timezone `America/Fortaleza` e agenda diária às 09h. A execução oficial `2794` terminou com `success`, percorreu geração e listagem, encontrou zero cobranças elegíveis e não criou reservas nem callbacks.
- Um teste controlado de cobrança vencida foi criado para o número final `6994`, no valor de R$ 1,00 e com ciclo temporário `3edeb92f-3d4b-4cca-b61b-0347fca5e5bc`. A primeira execução (`2811`) parou no render antes da reserva porque o JSON havia sido publicado com leitura ANSI do PowerShell; nenhum envio ocorreu.
- O workflow foi republicado com UTF-8 explícito e hash do `jsCode` remoto igual ao local. A execução `2813` terminou com `success`, reservou a tentativa 1 e a Meta aceitou o template vencido com o evento `48c6dbee-1fe9-4192-a0a3-27633f45ffb6`; após três minutos, o status permanecia `accepted` e `message_sent_at` corretamente nulo enquanto aguardava callback de entrega/leitura.
- O usuário confirmou em 2026-07-19 a validação completa do modo de múltiplos planos de mensalidade e dos controles de desativação/reativação do cadastro via WhatsApp no Professor Teste.
- A auditoria do callback confirmou que o App `Assistente Jack` está inscrito no WABA oficial, com callback ativa em `https://app.meuassistentevirtual.com.br/api/whatsapp/webhook` e campo `messages` habilitado na Graph API v25.0.
- A ausência de baixa foi causada pela RPC `admin_record_billing_reminder_delivery_status`: o alvo `ON CONFLICT (provider_message_id, delivery_status, status_updated_at)` colidia com o parâmetro de saída `delivery_status` e gerava PostgreSQL `42702`.
- A migration 051 foi aplicada em produção para usar `ON CONFLICT ON CONSTRAINT`. A entrega confirmada pelo usuário foi reconciliada com origem `manual_user_confirmation`, o ciclo recebeu `message_sent_at` e a repetição do mesmo callback manteve apenas um registro, validando idempotência.
- Após a correção, a execução oficial `2830` enviou uma cobrança de R$ 1,00 com vencimento no dia para o número final `6994`, usando `jack_billing_due_reminder_v2`. Os callbacks automáticos `sent` e `delivered` foram persistidos, e `message_sent_at` só foi preenchido no `delivered`.
- Os dois ciclos artificiais de R$ 1,00 usados nos testes vencido e do dia foram removidos após a validação, junto com seus eventos por cascade; os ciclos financeiros reais permaneceram intactos.
- Em 2026-07-19, uma validação transacional no Supabase de produção simulou três callbacks `failed`: bloqueou duplicidade no mesmo dia, permitiu somente uma nova tentativa por dia até o limite de três, recusou a quarta tentativa e manteve `message_sent_at` nulo. A transação terminou em `ROLLBACK`, sem criar cobrança, evento ou callback persistente e sem enviar mensagem.
- Em 2026-07-19, foram submetidos à Meta os templates `jack_billing_due_reminder_v3` (`1041055674977367`), com “vence hoje”, e `jack_billing_overdue_reminder_v2` (`2124744398115629`), com “venceu em”; ambos ficaram `PENDING`. Como a Meta proíbe variável no fim do corpo (`2388299`), o único emoji foi movido para depois de “equipe de {{2}}”. O workflow permanece nas versões aprovadas anteriores até a aprovação das revisões.
- Os dois templates revisados foram aprovados pela Meta em produção em 2026-07-19. A migration 052 atualizou atomicamente as RPCs de listagem e reserva para `jack_billing_due_reminder_v3` e `jack_billing_overdue_reminder_v2`; a prévia sob `ROLLBACK` passou antes da aplicação.
- O workflow oficial foi publicado com “vence hoje (data)” para o dia, “venceu em (data) e está pendente” para atraso e um único `😊` após o tenant. A execução oficial `2851` terminou com `success`, encontrou zero cobranças elegíveis antes e depois, e a agenda foi restaurada ativa às 09h em `America/Fortaleza`.
- Em 2026-07-19, os casos de borda do Professor foram validados em produção: rejeição sem aluno ou financeiro, CPF pendente e cadastrado, identidade completa, responsável para menor de 14 anos e disputa da última vaga com apenas uma aprovação. A rodada de banco ocorreu sob `ROLLBACK`.
- O webhook oficial do módulo foi percorrido com números fictícios para um adulto, repetição duplicada e um menor com responsável; as respostas de CPF pendente/cadastrado foram confirmadas. Um adulto sintético foi aprovado para comprovar perfil e primeiro ciclo, e todos os clientes, perfis, ciclos, solicitações e conversas artificiais foram removidos ao final.
- A auditoria mostrou que “atendimento humano” durante um módulo ativo era encaminhado ao formulário. A migration 053 passou em prévia, foi aplicada e revalidada: o handoff do tenant agora tem prioridade e fecha o estado transitório do módulo.
- O workflow remoto `DAILY_BILLING_REMINDERS` passou a usar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente do n8n, em vez de credenciais fixas nos nos HTTP.
- O nó de cobrança usa conteúdo controlado pelo produto e o template oficial correspondente quando a janela de atendimento exige.
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
- Correcao SQL de 2026-05-25: `admin_ensure_tenant_whatsapp_entry_link` foi ajustada no repositorio para trocar o nome de retorno `tenant_id` por `link_tenant_id` e evitar ambiguidade no Postgres.
- Em 2026-06-06, `supabase/tenant_whatsapp_entry_links.sql` foi reaplicado no Supabase alvo via CLI e a funcao `admin_ensure_tenant_whatsapp_entry_link` foi confirmada com retorno `TABLE(link_tenant_id uuid, code text)`.
- Templates padrao de WhatsApp atualizados para a persona `Assistente Jack`; SQL incremental criado em `supabase/tenant_message_templates_assistente_jack.sql` e migration `supabase/migrations/008_assistente_jack_message_persona.sql`.
- Inbound generico de cadastro por WhatsApp para tenants com cobranca mensal foi versionado em 2026-05-25:
  - SQL incremental `supabase/whatsapp_billing_signup_workflow_support.sql`;
  - migration `supabase/migrations/010_whatsapp_billing_signup_workflow.sql`;
  - workflow n8n inativo `n8n/WA_TENANT_BILLING_SIGNUP_INBOUND_v1.workflow.json`;
  - mensagem fixa de cadastro `billing_signup_welcome`;
  - fluxo coleta nome completo, grupo/turma opcional, valor da mensalidade e dia de vencimento;
  - cria ou reativa cliente pelo WhatsApp, cria/atualiza perfil de cobranca e gera ciclo inicial pendente.
- Em 2026-06-22, workflow remoto `WA_TENANT_BILLING_SIGNUP_INBOUND_v1` foi criado no n8n com id `A4XOl16nkcIYOre1` e mantido inativo para go-live controlado.
- Em 2026-06-22, webhook do app passou a encaminhar ao n8n o `inbox_thread_id` e `inbox_routed` quando a mensagem inbound foi gravada na inbox, preparando a entrada central/roteador n8n para decidir fluxo por conversa/tenant.
- Em 2026-06-22, roteador central remoto `WA_INBOUND_ROUTER_v1` foi criado no n8n com id `JSlq95lyTAVjZjtz`, ativado e testado com payloads fake de agenda/cadastro, respondendo 200 e classificando corretamente as rotas.
- Em 2026-06-23, `WA_INBOUND_ROUTER_v1` foi ajustado para priorizar menu numerado: `1` agenda, `2` cadastro/mensalidades, `3` atendimento humano; palavras-chave permanecem apenas como fallback e entrada invalida retorna o menu.
- Em 2026-06-23, webhook Meta do app passou a consumir `reply_text` retornado pelo roteador n8n, enviar a resposta pelo WhatsApp Cloud API e registrar a mensagem na inbox como bot quando houver thread roteada.
- Em 2026-06-23, roteador/app ficaram preparados para disparo controlado de modulos via `target_webhook_path` + `dispatch_to_module`; o disparo real depende de `WA_INBOUND_ROUTER_DISPATCH_ENABLED=true` no n8n.
- Em 2026-06-23, adaptador WhatsApp Cloud e endpoint interno passaram a suportar mensagens interativas basicas de botoes e listas, mantendo texto como fallback operacional.
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
- Excluir serviço: desativação por `is_active = false`.
- Excluir profissional: exclusão definitiva após tratar agendamentos futuros, com snapshots históricos e evento de auditoria preservados.
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
- Em 2026-06-06, vulnerabilidades de dependencias foram tratadas com update controlado: `next`/`eslint-config-next` para `16.2.7`, `ws` e `brace-expansion` atualizados pelo lockfile, e `postcss` forçado via `overrides` para versao corrigida. `npm audit --audit-level=moderate` passou com 0 vulnerabilidades.
- Em 2026-06-22, nova rodada de `npm audit --audit-level=moderate` apontou `@babel/core` e `js-yaml`; `npm audit fix` atualizou apenas o lockfile e a auditoria voltou a passar com 0 vulnerabilidades. `npm run lint` e `npm run build` tambem passaram.
- Relatorio complementar salvo em `docs/validation-2026-06-22.md`.
- Runbook de go-live WhatsApp criado em `docs/whatsapp-go-live-runbook.md`.
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

## Pendencias Atuais

### Aguardando Meta

1. Aguardar aprovacao do App Review para `whatsapp_business_messaging`.
2. Apos aprovacao, confirmar se o numero oficial, display name e WABA estao prontos para producao.
3. Testar challenge/webhook real da Meta em `https://app.meuassistentevirtual.com.br/api/whatsapp/webhook`.
4. Testar inbound real pelo WhatsApp oficial usando link de tenant com codigo `jack-xxxxxxxx`.
5. Testar envio real pela inbox tenant-side e gravar evidencia para operacao.

### Banco a Aplicar

1. Aplicar `supabase/tenant_business_type_catalog_expansion.sql` (migration `019_business_type_catalog_expansion.sql`) no Supabase alvo: amplia o CHECK de `tenants.business_type` para aceitar `loja_material` e `petshop`. Sem isso, criar tenant desses tipos falha no banco. Aditivo e idempotente.

### Seguranca e Env Antes do Go-live

1. Criar `WHATSAPP_INBOUND_N8N_TOKEN` e configurar o mesmo segredo no ambiente do n8n e na Vercel.
2. Configurar na Vercel `WHATSAPP_INBOUND_N8N_WEBHOOK_URL` apontando para o roteador central:
   - `/webhook/wa-inbound-router-v1`.
3. Confirmar/rotacionar credenciais sensiveis usadas em testes antes de producao:
   - `WHATSAPP_CLOUD_ACCESS_TOKEN`;
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
   - `WHATSAPP_APP_SECRET`;
   - `SUPABASE_SERVICE_ROLE_KEY`, se tiver sido exposta fora dos ambientes seguros.
4. Manter `WA_INBOUND_ROUTER_DISPATCH_ENABLED` desligado ate o teste controlado com tenant real.

Concluido em 2026-07-16: `WHATSAPP_INTERNAL_SEND_TOKEN` foi rotacionado e sincronizado com uma credencial segura do n8n.

### Go-live Controlado WhatsApp

1. Usar `salaoteste@teste.com` como tenant inicial de validacao.
2. Confirmar que mensagem inbound aparece na inbox e que resposta automatica do roteador e registrada como bot quando houver `reply_text`.
3. Ativar, um por vez, os workflows de modulo que ainda ficam inativos:
   - `WA_TENANT_BILLING_SIGNUP_INBOUND_v1`;
   - `DAILY_APPOINTMENT_CONFIRMATION_REMINDERS`.
4. Somente depois dos modulos validados, ligar `WA_INBOUND_ROUTER_DISPATCH_ENABLED=true` no n8n.
5. Testar fluxo de agenda completo em tenant `plan2`/`plan3`:
   - menu numerado;
   - selecao de servico;
   - selecao/pulo de profissional quando aplicavel;
   - sugestao de horarios;
   - criacao, remarcacao e cancelamento.
6. Testar fluxo de cadastro/mensalidade em tenant `plan1`/`plan3`.

Concluidos: `WA_TENANT_APPOINTMENTS_INBOUND_v1` esta ativo desde 2026-07-14; `DAILY_TENANT_AGENDA_REMINDERS` foi validado e ativado em 2026-07-16.

### Produto / Proximas Evolucoes

- Roadmap detalhado de botões, listas, busca tolerante e confirmações salvo em `docs/whatsapp-interactive-roadmap.md`.
- Planejar bloqueios extraordinarios de agenda por intervalo continuo, por tenant ou profissional (ex.: terca 14h ate quinta 10h), com deteccao de conflito em agendamentos existentes.

1. Evoluir mensagens WhatsApp para botoes/listas interativas quando o uso em producao estiver liberado.
2. Planejar workflow WhatsApp de restaurante separado do fluxo de agenda/cobranca, usando `tenant_menu_groups`, `tenant_menu_items` e `tenant_restaurant_orders`.
3. Planejar agenda de mesas/reservas para `plan5`, com tabelas e workflow proprios, sem reaproveitar a agenda de servicos de salao/clinica.
4. Quando WhatsApp estiver ponta a ponta, iniciar integracao de pagamentos:
   - QR Code Pix para pedidos de restaurante;
   - QR Code Pix para cobrancas mensais;
   - cartao de credito;
   - conciliacao automatica.
5. Implementar confirmacao Asaas/QR code para pagamentos da plataforma e depois para cobrancas dos clientes dos tenants.
6. Aplicar migrations consolidadas em staging e comparar schema/dados essenciais com o Supabase alvo.
7. Fazer teste multi-tenant com usuarios reais separados.
8. Preparar backups e politica de retencao.

## Decisoes para Evitar Gambiarra

- Nao confiar em regra visual do front para seguranca; regras sensiveis ficam no backend/RLS.
- Nao apagar historico importante sem snapshot.
- Nao depender de texto do front para status de negocio; front so traduz status tecnico.
- Nao duplicar ciclo de cobranca se ja existe ciclo do mesmo periodo/perfil.
- Nao misturar historico de plataforma com historico interno do tenant.
- Nao permitir funcionalidades por esconder botao apenas; rotas/API tambem validam capacidades do plano.
- Nao criar um workflow n8n por tenant/restaurante; usar workflows genericos orientados por dados e configuracoes do tenant.
- Centralizar mensagens do WhatsApp no produto e nos templates oficiais da Meta; não expor editores ao tenant nem duplicar textos divergentes nos workflows.
- Nao tratar SQL solto como produto final; ele e etapa de desenvolvimento antes das migrations.

## Prompt Para Continuar em Outra Task

### Atualizacao operacional de 2026-07-16

- Auditoria complementar de notificacoes D-1/H-1:
  - ambos os tipos usam o mesmo workflow e a mesma credencial corrigida;
  - todos os nos remotos que chamam `/api/internal/whatsapp/send` usam a credencial vigente;
  - simulacao D-1 retornou dois agendamentos de 20/07 para o WhatsApp terminado em 6994, com botoes de confirmar, remarcar e cancelar;
  - nenhum envio foi realizado durante a simulacao.
- A abertura automatica de `showPicker()` foi removida dos campos de data e hora porque ainda bloqueava a digitacao; clicar no campo agora apenas da foco, enquanto o icone nativo continua abrindo o calendario. Pendente validacao visual do usuario em producao.
- Incidente do lembrete H-1 identificado e corrigido:
  - `APPOINTMENT_CUSTOMER_NOTIFICATIONS` estava ativo, mas ainda usava a credencial anterior ao giro de `WHATSAPP_INTERNAL_SEND_TOKEN`;
  - execucoes falharam com `Authorization failed` e o H-1 das 19h nao foi enviado nem marcado;
  - workflow remoto e arquivo versionado passaram a usar a credencial Header Auth vigente;
  - execucao real das 19h35 concluiu ate `RPC_mark_notification_sent`;
  - H-1 do agendamento das 20h foi enviado ao WhatsApp terminado em 6994 e registrado uma unica vez.
- Precos comerciais vigentes sincronizados em producao:
  - Planos 1 e 2: R$ 49,90;
  - Plano 3: R$ 79,90;
  - Plano 4: R$ 99,90;
  - Plano 5: R$ 179,90.
- Descricoes dos cinco planos atualizadas para os novos precos e oito perfis de cobranca existentes sincronizados, inclusive os que tinham valor individual.
- API administrativa publicada para propagar toda alteracao futura de preco aos negocios vinculados e atualizar automaticamente o valor exibido na descricao.
- Migration `041_platform_plan_price_propagation.sql` executada no Supabase alvo em 2026-07-16; os cinco precos e descricoes foram conferidos e os oito perfis vinculados ficaram sem divergencias.
- Migration `040_teacher_signup_identity_and_guardian.sql` aplicada no Supabase alvo:
  - cadastro do aluno passou a exigir e-mail, CPF e data de nascimento;
  - menores de 14 anos exigem nome completo e CPF do responsavel;
  - o mesmo WhatsApp pode representar mais de um aluno, mas CPF nao pode se repetir no mesmo tenant;
  - duplicidade de CPF cadastrado ou pendente retorna estado explicito ao fluxo.
- Campos nativos de data e hora foram padronizados para aceitar digitacao direta e manter o seletor nativo como atalho.
- Textos corrompidos da pausa de agenda foram corrigidos para `Incluir pausa de almoço/descanso` e `Duração da pausa`.
- Resumo diario da agenda validado com dois agendamentos reais no Salao de Beleza:
  - mensagem recebida no WhatsApp de teste terminado em 6994;
  - envio registrado uma unica vez no Supabase;
  - workflow `DAILY_TENANT_AGENDA_REMINDERS` ativo no n8n;
  - token interno de envio rotacionado na Vercel e armazenado em credencial Header Auth do n8n;
  - workflow versionado em `n8n/DAILY_TENANT_AGENDA_REMINDERS.workflow.json`.
- Validacoes tecnicas do fechamento: JSON do workflow, ESLint, TypeScript e build Next.js aprovados; deploy de producao e push no Git concluidos no commit `59fa5a6`.

### Atualizacao operacional de 2026-07-14

- Identidade publica do tenant separada em dois campos:
  - legal_name: nome completo ou razao social, usado no cadastro administrativo;
  - public_name: nome fantasia, usado na busca e nas mensagens do Assistente Jack.
- Cadastro publico, criacao administrativa, edicao pela plataforma e configuracoes do tenant passaram a coletar/exibir os dois nomes.
- Nome fantasia do tenant Samara atualizado no Supabase para Samara.
- Lista de resultados do WhatsApp deixou de repetir o mesmo nome como titulo truncado e descricao completa.
- Menus institucionais, menu do tenant, confirmacao e retorno ao menu principal usam interacoes do WhatsApp quando aplicavel.
- Webhook do app passou a enviar e registrar a resposta devolvida pelos workflows de modulo do n8n.
- WA_INBOUND_ROUTER_v1 remoto atualizado para liberar dispatch quando o RPC solicitar um modulo.
- WA_TENANT_APPOINTMENTS_INBOUND_v1 remoto ativado para o primeiro teste controlado real.
- Validacoes concluidas: ESLint, TypeScript, build local, build Vercel e GET /api/health em producao.
- Bloqueios extraordinarios de agenda por intervalo continuo foram implementados na migration `026_tenant_appointment_blocks.sql`, integrados as sugestoes do Jack, a criacao de agendamentos e a tela do tenant, e publicados em producao.
- Teste real revelou que a mensagem seguinte ao clique em `Agendar` voltava ao menu do tenant: o roteador geral nao priorizava uma `wa_conversations` de modulo ainda aberta.
- Correcao preparada na migration `027_whatsapp_module_continuity_and_full_reset.sql`:
  - conversa aberta de agenda ou cobranca passa a ter prioridade e continua no respectivo workflow ate o encerramento;
  - reset centralizado remove sessoes de roteamento e estado transitorio de modulo, fecha threads abertas e preserva o historico de mensagens;
  - comandos `Menu do Jack` e `menu principal` executam o reset completo antes de voltar ao institucional.
  - equivalencia de telefone brasileiro cobre o `wa_id` da Meta com ou sem o nono digito; o numero de teste `5583998036994` chegou no webhook como `558398036994`, causa do reset anterior nao encontrar o vinculo.
- Migration 027 executada no Supabase alvo em 2026-07-14.
- Reset completo validado no numero de teste informado como `5583998036994`: a variante Meta `558398036994` foi reconhecida; 1 sessao de tenant e 1 conversa de modulo foram removidas, 1 thread foi fechada e nenhum vinculo aberto permaneceu.
- Continuidade validada com teste sintetico reversivel: uma conversa `collect_full_name` retornou `route=appointments`, `reason=continue_active_module` e `request_dispatch=true`; os registros sinteticos foram removidos ao final.
- Falta apenas repetir o teste real pelo WhatsApp: `Ola -> tenant -> Agendamentos -> Agendar -> nome completo`.
- Revisao da experiencia de agenda preparada em `028_whatsapp_appointment_experience.sql`:
  - unicidade de `wa_conversations` passa a valer somente para conversa aberta, permitindo iniciar novo atendimento depois de concluir o anterior;
  - configuracoes `opens_at`, `closes_at` e timezone sao injetadas no estado do workflow;
  - rotulos de horarios passam a usar nome completo do dia em portugues;
  - agradecimento apos agendamento recebe resposta contextual, sem repetir a saudacao de entrada do tenant.
- Adaptador do WhatsApp preparado para transformar opcoes numeradas da agenda em botoes quando houver ate 3 e listas quando houver mais, incluindo servicos, profissionais, periodos, horarios e confirmacao.
- Workflow remoto `WA_TENANT_APPOINTMENTS_INBOUND_v1` atualizado em 2026-07-14 mantendo ID `X1lUop6Q5fh9uxTG` e estado ativo; para tenant 08:00-18:00, oferece manha, tarde e primeiro horario livre, sem noite.
- Causa do atendimento parar ao reabrir agenda confirmada nas execucoes n8n 758 e 761: `duplicate key value violates unique constraint wa_conversations_chat_uq`; corrigida pela migration 028.
- Validacoes locais da revisao: sintaxe do Code node n8n, TypeScript, ESLint e build Next.js aprovados.
- Migration 028 executada no Supabase alvo em 2026-07-14.
- Validacao ao vivo da 028:
  - configuracoes da agenda enriquecidas como `08:00-18:00`, timezone `America/Fortaleza`;
  - horario exibido como `Terça-feira, 14/07 às 11:00 com Lucas`;
  - agradecimento apos conclusao retornou `tenant_post_appointment` com contexto correto.
- A validacao de reabertura encontrou que `wa_conversations_chat_uq` existe no ambiente como indice unico independente, e nao como constraint; por isso o `drop constraint` da 028 nao o removeu.
- Migration corretiva `029_whatsapp_active_conversation_index_fix.sql` criada para remover as duas representacoes possiveis e manter apenas a unicidade de conversa ativa. Pendente executar no Supabase.
- Reset completo repetido para `5583998036994`/`558398036994`: 1 sessao de tenant e 1 conversa de modulo removidas, 1 thread fechada e nenhum contexto ativo restante.
- Migration 029 executada no Supabase alvo e deploy em producao autorizado pelo usuario em 2026-07-14.
- A validacao reversivel posterior encontrou um segundo indice unico legado, `ux_wa_conversations_chat_id`, ainda impedindo reabrir a agenda depois de uma conversa concluida.
- Migration `030_whatsapp_legacy_chat_index_fix.sql` criada para remover esse segundo indice e preservar apenas `wa_conversations_active_chat_uq` por tenant, cliente e conversa aberta. Pendente executar no Supabase.
- Migration 030 executada no Supabase alvo em 2026-07-14.
- Invariantes de conversa validados com dados sinteticos reversiveis:
  - historico concluido permanece armazenado;
  - somente uma conversa aberta e permitida por tenant e cliente;
  - uma nova conversa pode ser aberta depois do fechamento;
  - o mesmo telefone pode manter contexto independente em tenants diferentes;
  - o bloqueio de duplicidade ativa vem de `wa_conversations_active_chat_uq`.
- Lint e build Next.js 16.2.7 aprovados no estado final.
- Deploy de producao concluido: `dpl_BrA1Tczq7246m8FSXh1XYkkadU2D`, alias `supabase-saas-nine.vercel.app`.
- `https://app.meuassistentevirtual.com.br/api/health` e o alias Vercel responderam HTTP 200 com `ok=true`.
- Contexto de teste de `5583998036994`/`558398036994` verificado apos o deploy: zero sessoes de roteador, sessoes de tenant, conversas de modulo e threads abertas.
- Pendente apenas repetir o teste real completo pelo WhatsApp.
- Revisao de UX da agenda preparada em 2026-07-14 apos teste real:
  - periodo `Primeiro horario livre` reduzido para `Primeiro livre`, dentro do limite visual do botao;
  - horarios interativos usam titulos compactos como `Ter 14/07 às 11:00`; listas preservam o rotulo completo na descricao;
  - opcoes de agendamentos existentes usam `14/07 às 12:30`, sem corte arbitrario;
  - conclusoes de criar, remarcar e cancelar possuem estados e textos distintos, sem agradecimento presumido;
  - respostas de conclusao e mensagens aleatorias posteriores oferecem `Agendamentos`, `Falar com pessoa` e `Menu do Jack`, sem repetir a saudacao de entrada do tenant.
- Workflow remoto `X1lUop6Q5fh9uxTG` atualizado e ativo em `2026-07-14T15:22:03.021Z`.
- Maquina de estados validada por execucao dos caminhos `suggest_slots` e `appointment_cancelled`; `last_action` fica apenas na conclusao, nao na sugestao.
- TypeScript, lint, build Next.js e sintaxe dos nos de codigo aprovados.
- Pendente: autorizacao explicita para publicar o novo adaptador do app em producao e repetir o teste real.
- Tela `/appointments` compactada para remover a rolagem horizontal na tabela: grade lateral reduzida, cards de resumo menores, tabela com layout fixo, colunas proporcionais e controles compactos.
- Todos os inputs nativos de data/hora da agenda usam cursor de clique e `showPicker()` ao clicar em qualquer parte do campo, com fallback nativo para navegadores sem suporte.
- Build Next.js 16.2.7, TypeScript e ESLint aprovados apos a revisao responsiva.
- Pendente: autorizacao explicita para publicar em producao o adaptador WhatsApp e a revisao visual da agenda.
- Usuario autorizou explicitamente em 2026-07-14 o deploy em producao das alteracoes futuras que solicitar neste projeto, apos validacao tecnica proporcional ao risco.
- Adaptador WhatsApp revisado e tela de agenda compactada publicados no deployment `dpl_48RrDKMkkHSdZFHCmyJiXmBLvVYs`.
- Dominio oficial e alias Vercel responderam HTTP 200 com `ok=true` apos o deploy.
- Pendente apenas validacao visual/funcional real pelo usuario no WhatsApp e na tela `/appointments`.
- Auditoria independente de WhatsApp realizada em 2026-07-14:
  - checklist Vercel atualizado com dominios e estado reais de producao;
  - runbook corrigido para nao recomendar a desativacao do workflow de agenda ja ativo em teste controlado;
  - headers defensivos globais adicionados no Next.js: `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`;
  - listagem de clientes/alunos ganhou cartoes responsivos no celular, preservando a tabela completa no desktop e eliminando rolagem lateral nessa operacao.
  - deploy de producao concluido em `dpl_7e3NtboXSDAm7RBo9RbFoUxZW4tK`; health HTTP 200 e headers confirmados no dominio oficial.

```text
Bom dia, Codex. Estamos no projeto `c:\Users\Jamys\billing-app`.

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
- Runbook WhatsApp criado em `docs/whatsapp-go-live-runbook.md`.
- Migrations consolidadas foram criadas em `supabase/migrations/`, mas ainda precisam ser aplicadas em staging e comparadas com o Supabase alvo.
- SQLs de inbox/link WhatsApp foram aplicados e `supabase/tenant_whatsapp_entry_links.sql` foi reaplicado no Supabase alvo em 2026-06-06.
- O arquivo `supabase/tenant_plan_feature_trigger_diagnostic.sql` e diagnostico e ficou fora da ordem de aplicacao.
- Workflows n8n versionados continuam genericos; nao criar workflow por tenant.
- Roteador central n8n `WA_INBOUND_ROUTER_v1` existe no n8n remoto com id `JSlq95lyTAVjZjtz`, ativo, com menu numerado:
  - 1: agenda;
  - 2: cadastro/mensalidades;
  - 3: atendimento humano.
- O app ja consome `reply_text` do roteador e pode enviar/resgistrar resposta automatica como bot.
- Em 2026-07-14, o roteamento da inbox passou a priorizar o tenant confirmado pelo roteador; a caixa institucional recebeu envio manual pelo numero oficial do Jack.
- Em 2026-07-14, o fluxo de agenda voltou a responder apos a compatibilidade de `tenant_customers.birth_date`; teste sintetico do modulo retornou o menu de agendar, remarcar e cancelar.
- O app e o roteador disparam modulos via target_webhook_path + dispatch_to_module; o workflow de agenda esta ativo desde 2026-07-14.
- Adaptador WhatsApp Cloud ja suporta texto, botoes e listas via `src/lib/whatsapp-cloud.ts` e `POST /api/internal/whatsapp/send`.

Proxima prioridade:
1. Aguardar aprovacao da Meta para `whatsapp_business_messaging`.
2. Quando o usuario criar o segredo, configurar `WHATSAPP_INBOUND_N8N_TOKEN` no n8n e na Vercel.
3. Configurar `WHATSAPP_INBOUND_N8N_WEBHOOK_URL` na Vercel apontando para `/webhook/wa-inbound-router-v1`.
4. Fazer o teste controlado do fluxo de agenda ja ativado.
5. Depois testar WhatsApp real:
   - challenge do webhook Meta;
   - mensagem inbound real;
   - envio pelo endpoint interno;
   - fluxo de agendamento em tenant `plan2` ou `plan3`;
   - fluxo de cadastro/mensalidade em tenant `plan1` ou `plan3`.
6. Aplicar migrations consolidadas em staging e comparar schema/dados essenciais com o Supabase alvo.
7. Manter tudo idempotente, auditavel, seguro por tenant e sem depender apenas do front para regra de negocio.
```
