# Roadmap de experiência interativa do Assistente Jack

## Princípios

- Texto livre continua aceito em todas as etapas.
- Botões e listas reduzem erro, mas nunca são a única forma de avançar.
- IDs das opções são estáveis; títulos podem mudar sem quebrar o roteamento.
- Toda seleção sensível recebe confirmação antes de alterar tenant, cadastro, agenda ou cobrança.
- O histórico permanece separado por tenant e auditável.
- O menu institucional e os menus de capacidade são gerenciados pela plataforma.
- Mensagens específicas de cada fluxo continuam configuráveis pelo tenant.

## Fase 1 — Institucional e descoberta de tenants

1. Menu principal com três botões visíveis:
   - Conhecer o Jack;
   - Encontrar negócio;
   - Falar com pessoa.
2. Busca por tenant usando:
   - nome público;
   - razão/nome legal;
   - aliases configuráveis;
   - normalização de acentos, pontuação e espaços;
   - similaridade para erros de digitação.
3. Resultado único ou melhor palpite:
   - perguntar `Você quis dizer ...?`;
   - botões `Sim` e `Não`.
4. Vários resultados plausíveis:
   - mostrar lista interativa;
   - após a escolha, pedir confirmação `Sim` ou `Não`.
5. Resposta negativa:
   - pedir desculpas;
   - oferecer novamente os botões do menu principal.
6. Troca de negócio:
   - comandos textuais tolerantes;
   - expiração por duas horas de inatividade;
   - histórico preservado por tenant.

## Fase 2 — Entrada e cadastro no Jack

1. Apresentar capacidades e planos sem preço enquanto a precificação não estiver consolidada.
2. Botões para:
   - conhecer recursos;
   - iniciar cadastro;
   - falar com atendimento humano.
3. Cadastro guiado com confirmação de dados antes do envio.
4. Retomada segura de cadastro incompleto.
5. Handoff humano com contexto completo da conversa.

## Fase 3 — Agenda

1. Botões para agendar, remarcar ou cancelar.
2. Lista de serviços disponíveis conforme o tenant.
3. Lista de profissionais, com seleção automática quando houver apenas um.
4. Botões de período e lista de horários.
5. Confirmação final com `Confirmar` e `Voltar`.
6. Remarcação e cancelamento com confirmação de identidade.
7. Fallback textual tolerante para todas as etapas.
8. Bloqueios extraordinários de disponibilidade por intervalo contínuo:
   - início e fim com data e hora;
   - exemplo: terça-feira às 14h até quinta-feira às 10h;
   - motivo opcional (folga, viagem, manutenção ou evento);
   - aplicação por tenant e, quando necessário, por profissional;
   - impedir novas reservas sem alterar agendamentos existentes silenciosamente;
   - alertar a equipe quando um bloqueio conflitar com horários já marcados.

## Fase 4 — Cadastro de cliente e cobrança

1. Botões para cadastro, mensalidade, segunda via e atendimento humano.
2. Seleção de grupo/turma por lista.
3. Validação tolerante de valor, vencimento e dados pessoais.
4. Resumo antes da confirmação.
5. Confirmação por botões.
6. Preparação para Pix e conciliação, sem acoplar o fluxo ao provedor de pagamento.

## Fase 5 — Catálogo, pedidos e reservas

1. Catálogo por listas e mensagens de produto quando o catálogo Meta estiver configurado.
2. Carrinho e confirmação do pedido.
3. Acompanhamento do status.
4. Fluxo separado para reservas de mesas no plano correspondente.
5. Não reutilizar agenda de serviços para restaurante.

## Fase 6 — Operação e qualidade

1. Caixa institucional e caixas de tenant com estados consistentes.
2. Métricas de abandono, erro de interpretação, fallback e handoff.
3. Testes multi-tenant e de isolamento de dados.
4. Catálogo de frases reais que falharam para evoluir aliases e tolerância.
5. Versionamento dos contratos entre Vercel, Supabase e n8n.
6. Ativação gradual dos módulos do n8n, um fluxo por vez.

## Critérios de aceite por fluxo

- Funciona por toque e por texto livre.
- Erros de ortografia comuns não encerram a conversa.
- Nenhum palpite troca de tenant sem confirmação explícita.
- `Não` sempre oferece saída clara ou menu principal.
- Respostas enviadas e recebidas ficam registradas na caixa correta.
- O fluxo respeita plano, tenant e janela de duas horas.
