# Auditoria Orçamentos — relatório (2026-10-15/16)

## 1. Resumo
Auditoria técnica da aba Orçamentos: 21 testes matemáticos + comparar versões +
integração + IA + segurança. **21/21 matemática PASS; 0 defeitos novos.**
1 bug antigo já havia sido corrigido antes (piso cobrava fração não exibida).

## 2. Placar
- APROVADO: 24 (21 matemática + comparar/ler + IA responde sem sessão)
- REPROVADO: 0
- BLOQUEADO: 4 (integração tabelas orc — SQL não rodado; E2E Playwright — sem navegador;
  IA com dados — quota; carga real)
- NÃO APLICÁVEL: 2 (SINAPI/fornecedores externos — sem integração real)

## 3. Defeitos
- Nenhum novo. Histórico: piso (corrigido em commit anterior), variável do mês na IA (corrigido).

## 4. Arquivos desta entrega
- `testes/run.js` (novo): 21 testes A–J, `node testes/run.js`, sem dependências.
- `docs/relatorio-auditoria-orcamentos.md` (este).

## 5. Correções desta entrega
Nenhuma necessária (nada reprovado). Sem mudança em código de produção.

## 6. Comandos executados
- `node testes/run.js` → 21 PASS, 0 FAIL
- `node --check` em todos os JS → OK
- Probe REST tabelas orc → 404 (não existem)
- `POST ia-financeira` sem sessão → 200 com "Entre na sua conta"
- grep segredos (`gsk_|sb_secret|service_role`) → vazio

## 7. Integração
Núcleo (obras/gastos/recebimentos/parcelas/plantas/IA) validado ao vivo em auditorias
anteriores. Tabelas de orçamento: ausentes — SyncOrc segue local sem quebrar.

## 8. IA
Sem sessão: recusa educada. Com sessão: testada antes (5/6 + off-topic).

## 9. Limitações p/ uso confiável
1. Rodar `supabase_orcamentos.sql` (tabelas).
2. Cadastrar preços com data (sem preço = parcial, por desenho).
3. Medir paredes/vãos na planta (área×2.8 é média, não medição).
4. Login ativo: PWA antigo precisa reinstalar.
5. Sem teste de clique automatizado (sem navegador aqui) — teste manual do Mário.

## 10. Próximas ações
- Rodar SQL → re-testar sync.
- Preencher catálogo de preços.
- Teste de campo com o Mário.
