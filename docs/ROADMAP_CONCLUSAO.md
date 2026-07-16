# Roadmap de conclusão do Billing App

Atualizado em: 2026-07-16

Este checklist é a referência operacional até o lançamento. Itens concluídos permanecem registrados para evitar reabertura acidental de escopo.

## Critério de conclusão

- [ ] Bloqueadores do lançamento concluídos.
- [ ] Fluxos críticos validados em produção nos planos correspondentes.
- [ ] Regras de tenant e plano garantidas no banco e nas APIs.
- [ ] Falhas operacionais relevantes registradas e monitoradas.

## Etapa atual — Professor, alunos e mensalidades

### Mensalidade fixa

- [x] Configurar valor e vencimento fixos no Professor Teste.
- [x] Confirmar que a configuração é salva e reaparece no painel.
- [x] Resetar o contexto do WhatsApp antes da rodada definitiva.
- [x] Iniciar cadastro pelo link do Professor Teste.
- [x] Confirmar que valor e vencimento vêm do tenant, sem digitação pelo aluno.
- [x] Selecionar turma por botão ou lista.
- [x] Confirmar os dados por botões.
- [x] Confirmar a solicitação em Cadastros pendentes.
- [x] Editar a turma antes da aprovação.
- [x] Aprovar e conferir aluno, perfil de cobrança e ciclo inicial.
- [ ] Rejeitar outra solicitação e confirmar que nenhum registro financeiro foi criado.

### Planos de mensalidade

- [ ] Alterar temporariamente o Professor Teste para o modo Planos.
- [ ] Criar pelo menos dois planos com valores e vencimentos diferentes.
- [ ] Confirmar botões para até três planos e lista para mais de três.
- [ ] Concluir cadastro e conferir plano, valor e vencimento gravados.
- [ ] Desativar um plano e confirmar que ele desaparece do WhatsApp.
- [ ] Retornar o Professor Teste à configuração desejada.

### Controles e casos de borda

- [ ] Desativar o cadastro via WhatsApp e validar a mensagem.
- [ ] Reativar o cadastro e confirmar que o fluxo volta.
- [x] Preencher a última vaga de uma turma.
- [x] Confirmar que turma lotada não aparece em novos cadastros.
- [ ] Garantir que duas aprovações não ocupem a mesma última vaga.
- [ ] Repetir cadastro com o mesmo WhatsApp e validar a solicitação duplicada.
- [ ] Validar retorno ao menu e atendimento humano.
- [ ] Validar cadastro completo com e-mail, CPF e data de nascimento.
- [ ] Validar nome e CPF do responsável para aluno menor de 14 anos.
- [ ] Validar mensagem de CPF já cadastrado e CPF com solicitação pendente.

## Bloqueadores do lançamento

### Catálogo, pedidos e estoque — Planos 4 e 5

- [ ] Apresentar categorias e itens em listas interativas.
- [ ] Exibir descrição, preço e disponibilidade.
- [ ] Montar carrinho com item e quantidade.
- [ ] Permitir revisar, alterar e cancelar o carrinho.
- [ ] Confirmar pedido por botões.
- [ ] Registrar o pedido no tenant correto com idempotência.
- [ ] Dar baixa no estoque sem permitir quantidade negativa.
- [ ] Consultar e atualizar o status do pedido.
- [ ] Refletir pagamento e baixa no financeiro.
- [ ] Respeitar a janela de atendimento humano.
- [ ] Testar o fluxo completo nos Planos 4 e 5.

### Plano 5

- [ ] Confirmar se reservas entram na oferta comercial inicial.
- [ ] Se entrarem, criar modelo e fluxo próprios, sem reutilizar agenda de serviços.
- [ ] Implementar disponibilidade, criação, alteração e cancelamento.
- [ ] Testar conflitos e capacidade de mesas e horários.
- [ ] Se ficarem para depois, ajustar descrição e comunicação antes da venda.

### Ciclo de cobranças

- [ ] Validar criação automática do primeiro ciclo.
- [ ] Validar aviso de vencimento com nome, valor, data e Pix.
- [ ] Implementar ou validar segunda via pelo WhatsApp.
- [ ] Validar confirmação manual e histórico do pagamento.
- [ ] Validar cobrança vencida, reenvio e pausa ou reativação.
- [ ] Confirmar isolamento entre tenants.
- [ ] Decidir se conciliação automática de Pix entra no lançamento.

## Qualidade, segurança e regressão

- [ ] Criar testes automatizados para tenant, plano e idempotência.
- [ ] Cobrir agenda, cadastro do Professor e catálogo ou pedidos.
- [ ] Testar webhook duplicado sem duplicar efeitos.
- [ ] Auditar RLS e grants das migrations recentes.
- [ ] Confirmar validações de plano e tenant nas APIs.
- [ ] Testar dois tenants usando o mesmo telefone de cliente.
- [ ] Testar telas críticas em celular e desktop.
- [ ] Executar lint, TypeScript e build no release candidate.

## Operação de produção

- [ ] Aplicar a migration 041 para garantir no banco a propagação dos preços dos planos.
- [ ] Comparar migrations consolidadas com o schema de produção.
- [ ] Preparar staging ou procedimento reversível equivalente.
- [ ] Monitorar crons de D-1, H-1 e retenção.
- [ ] Criar alertas para falhas dos workflows críticos do n8n.
- [ ] Garantir exportação e versionamento dos workflows ativos.
- [ ] Revisar segredos de Vercel, Supabase, Meta e n8n.
- [ ] Confirmar backup e restauração do Supabase.
- [ ] Executar smoke test do domínio e de /api/health.
- [ ] Remover pendências antigas dos documentos de acompanhamento.

## Validação final por plano

- [ ] Plano 1: alunos, turmas, mensalidades, cadastro e cobrança.
- [ ] Plano 2: agenda, profissionais, bloqueios e notificações.
- [ ] Plano 3: cobrança e agenda sem conflito de roteamento.
- [ ] Plano 4: catálogo, pedidos, estoque e financeiro.
- [ ] Plano 5: Plano 4 mais o escopo decidido para reservas.
- [ ] Plataforma: tenants, planos, pagamentos e inbox institucional.

## Funcionalidades já validadas

- [x] Agendar, remarcar e cancelar pelo WhatsApp.
- [x] Bloqueio temporário de agenda.
- [x] Confirmação D-1 e lembrete H-1.
- [x] Resumo diário da agenda enviado 30 minutos antes do expediente.
- [x] Idempotência do resumo diário validada com dois agendamentos reais.
- [x] Continuidade e reset do WhatsApp.
- [x] Inboxes de tenant e plataforma.
- [x] Janela de atendimento humano.
- [x] Retenção de mensagens por seis meses.
- [x] Gerenciamento unificado de alunos.
- [x] Mensalidade fixa configurada no Professor Teste.
- [x] Campos nativos de data e hora aceitam digitação e abertura do seletor.
- [x] Texto da pausa de almoço/descanso corrigido na agenda.
- [x] Descrições comerciais atualizadas para os preços vigentes dos cinco planos.
- [x] Mensalidades dos oito negócios existentes sincronizadas com seus planos.

## Depois do lançamento

- [ ] Conciliação automática de Pix, caso não entre no MVP.
- [ ] Catálogo nativo da Meta e mensagens de produto.
- [ ] Métricas de abandono, fallback e handoff.
- [ ] Painel de saúde dos workflows e webhooks.
