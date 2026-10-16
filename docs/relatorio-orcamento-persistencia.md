# Relatório — Orçamento conectado à IA da Obra (persistência completa)

Data: 2026-10-16
Autor: assistente de desenvolvimento (a pedido do dono do app)

## 1. Objetivo

Conectar completamente a aba **Orçamento** à **IA da Obra**, de forma que:

- o orçamento calculado seja **salvo por inteiro** (medidas, parâmetros,
  preços-base, itens por etapa, memória de cálculo e encargos/BDI), não só o
  `localStorage`;
- o cálculo continue **determinístico** (mesma entrada → mesma saída), sem
  substituir a matemática do app por estimativas da IA;
- a IA da Obra **consulte o orçamento salvo** (respeitando o dono / RLS);
- a interface permita **vincular uma obra**, **ver, duplicar, comparar e
  excluir** orçamentos salvos.

Regras respeitadas: nada de recriar o projeto, nada de remover o que funciona,
nada de chave no front, **sem executar SQL no banco remoto**, **sem
commit/push/deploy** e **sem presumir que o esquema remoto é igual ao do
repositório**.

## 2. O que foi feito (por etapa)

### Etapa 1 — Auditoria
- Identificado o fluxo **ativo**: Orçamento Guiado (`estimarObra()`, ligado em
  `script.js:2648` via `ligarOrcamentoGuiado()`).
- Confirmado que o antigo cluster **Raio-X** (`desenharRaioX`,
  `desenharSistema`, `calcularOrcamento`, `desenharComparacao`) é **código
  morto** (referencia ids que não existem mais na UI: `raiox-corpo`,
  `orcamento-area`, `orc-resultado`, `orc-calcular`). Mantido sem remoção.
- Antes desta tarefa, o salvamento guardava apenas `{area, alvenaria, total,
  itens[nome, etapa, qtd, unidade, preco, total]}` e **`obraId` sempre nulo**;
  perdia-se `etapa`, `detalhe` (memória de cálculo), `parametros` e o BDI.

### Etapa 2 — Persistência
- Criado `supabase_orcamentos_persistencia.sql` (**aditivo e idempotente, NÃO
  executado**):
  - `orcamentos.parametros jsonb`, `orcamentos.bdi jsonb`;
  - `orcamento_itens.etapa text`, `orcamento_itens.posicao integer` (índice
    **não-único** — o código insere antes de apagar);
  - `backfill` de `posicao` via `row_number` para linhas antigas;
  - `detalhe` (text) passa a guardar JSON.
- `supabase.js`:
  - `temColunaAusente(e)` — detecta `42703` / `42P01` / "schema cache";
  - funções **puras** de mapeamento: `parseDetalheOrc`, `linhaParaOrcamentoItem`,
    `linhaParaOrcamento`, `orcamentoParaLinha`, `orcamentoParaLinhaLegada`,
    `itemOrcamentoParaLinha`, `itemOrcamentoParaLinhaLegada`;
  - `SyncOrc.puxarOrcamentos` (`select("*")` + ordena por `posicao`) e
    `SyncOrc.empurrarOrcamento` (**fallback automático** para o formato antigo
    quando a coluna nova ainda não existe — funciona antes e depois da migração).

### Etapa 3 — Cálculo determinístico
- Extraídas funções puras em `orcamento.js`:
  - `calcularOrcamentoGuiado(e)` — **aritmética idêntica** à original;
  - `lerEntradaOrcamentoGuiado()` — lê o DOM;
  - `snapshotParametrosOrcamento(e)` — fotografa parâmetros/entradas/preços.
- `estimarObra()` agora: lê DOM → chama o motor puro → renderiza. O botão
  salvar grava `obraId`, `parametros`, itens com `etapa/detalhe/posicao` e
  atualiza a lista de salvos.

### Etapa 4 — Edge Function (IA da Obra)
- `supabase/functions/ia-financeira/index.ts`, modo "obra": usa
  `select("*")` (funciona antes e depois da migração), **filtra por
  `obra_id`** quando uma obra é escolhida, ordena itens por `posicao` e inclui
  `etapa`, `detalhe` (JSON, truncado) e BDI no contexto passado ao modelo.
- **Requer redeploy pelo usuário** (não feito nesta tarefa).

### Etapa 5 — Interface
- `index.html`: novo `<select id="og-obra">` ("Obra (opcional)") e novo card
  "Orçamentos salvos" com `#lista-orcamentos` e `#orcamento-detalhe`.
- `orcamento.js`: `renderOrcamentosSalvos`, `verOrcamentoSalvo`,
  `duplicarOrcamento`, `marcarComparar`, `desenharComparacao`,
  `atualizarObrasOrcamento`, `nomeObraOrc`, `elOrcDetalhe` reescritos para os
  containers reais. A lista agora mostra/duplica/compara/exclui; a atualização
  ocorre ao abrir a tela (`data-ir="orcamento"` e `#qa-orc-ia`).
- Cache-busting: `orcamento.js?v=5`, `supabase.js?v=17`, SW `mario-v20`.

### Etapa 6 — Testes
- `testes/run.js`: **Teste L** (motor guiado puro/determinístico, 12 asserts)
  e **Teste M** (persistência ida-e-volta, 17 asserts).
- Resultado atual: **79 PASS, 0 FAIL** (eram 50).

### Etapa 7 — Relatório
- Este documento.

## 3. Arquivos

Alterados:
- `index.html` (+12/− …)
- `orcamento.js` (+241)
- `supabase.js` (+134)
- `supabase/functions/ia-financeira/index.ts` (+43)
- `sw.js` (versão do cache)
- `testes/run.js` (+91)

Criado:
- `supabase_orcamentos_persistencia.sql` (não executado)

## 4. Como validar (passo a passo do usuário)

1. **Local**: `python -m http.server 8080` e abrir `http://localhost:8080`.
   - Login `mario` / `mario123`.
   - Aba Orçamento → preencher dados → Calcular → escolher uma **Obra** →
     Salvar. Conferir a lista, "Ver", "Duplicar", "Comparar", "Excluir".
2. **Testes**: `node testes/run.js` → deve terminar `79 PASS, 0 FAIL`.
3. **Migração (quando quiser persistir o formato novo)**: executar
   `supabase_orcamentos_persistencia.sql` no SQL Editor do Supabase. **Sem
   executar**, o app continua funcionando no formato antigo (fallback).
4. **Redeploy da Edge Function**: publicar `ia-financeira` com o `index.ts`
   atualizado (passo a passo já enviado anteriormente).
5. **Produção**: commit + push e, se necessário, bump do SW (já em `mario-v20`).

## 5. Riscos

- **Crítico**: nenhum.
- **Alto**: a migração e o redeploy ainda **não** foram aplicados; até então a
  IA da Obra não recebe `etapa/detalhe/BDI` no servidor e o formato novo não é
  persistido no banco (mas o app não quebra — há fallback).
- **Médio**: `atualizarObrasOrcamento()` depende da variável global `obras`
  estar carregada; se o usuário abrir a tela muito rápido, o seletor pode
  aparecer só com "Sem vínculo" até a próxima abertura (reabrir resolve).
- **Baixo**: comparação e "só no aparelho" dependem de dados em
  `localStorage`; sem teste de UI automatizado neste ambiente.

## 6. Limitações / não feito

- **Sem** execução de SQL no banco remoto (por regra).
- **Sem** redeploy da Edge Function (por regra).
- **Sem** commit/push (por regra) — aguardando autorização.
- Sem Deno/psql/tsc/navegador no ambiente: `.ts`/PL-pgSQL validados por leitura
  e balanceamento; UI sem teste automatizado.
- Não foi confirmado se a função `analisar-planta` já foi excluída do painel
  Supabase (pendência anterior).

## 7. Próximos passos

1. Autorizar e fazer commit + push (e redeploy da Edge Function).
2. Executar a migração e re-testar o "Ver" com itens por etapa vindos do banco.
3. Opcional: esconder/mostrar o card de salvos e adicionar teste de UI.
