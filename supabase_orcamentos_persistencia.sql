-- =====================================================
-- MARIO · ORÇAMENTOS — PERSISTÊNCIA COMPLETA (MIGRAÇÃO)
-- -----------------------------------------------------
-- ATENÇÃO: ARQUIVO PARA APLICAÇÃO MANUAL. NÃO é executado
--          automaticamente pelo app nem por scripts do repo.
--          Só rode isto no SQL Editor do Supabase quando você
--          quiser ligar a persistência ESTENDIDA do orçamento.
-- -----------------------------------------------------
-- O que faz:
--   Adiciona colunas que faltavam para guardar, junto do
--   orçamento, TUDO o que foi usado no cálculo:
--     - parâmetros/coeficientes (PARAMS_ORC)
--     - medidas informadas na tela (área, quartos, vãos, etc.)
--     - preços-base usados em cada item
--     - perdas aplicadas
--     - memória de cálculo (o "como foi calculado") por item
--     - a etapa de cada item
--     - a ORDEM dos itens
--     - o BDI (imprevistos/impostos/margem) quando houver
--
--   É ADITIVA: só adiciona colunas. NÃO apaga, NÃO renomeia,
--   NÃO muda tipo de dado existente e NÃO mexe em RLS.
--   É IDEMPOTENTE: pode rodar mais de uma vez sem erro.
--
-- Compatibilidade:
--   O app funciona SEM esta migração (modo degradado: guarda
--   apenas as colunas já existentes). Depois de aplicada, o
--   app passa a gravar e ler os campos extras sozinho — sem
--   precisar de nova publicação do site.
-- =====================================================

-- -----------------------------------------------------
-- 1) ORÇAMENTOS: guardar os parâmetros do cálculo e o BDI
-- -----------------------------------------------------
-- parametros: retrato do que foi usado (coeficientes,
--             medidas informadas, preços-base, perdas,
--             versão do motor de cálculo). jsonb permite
--             evoluir sem novas migrações.
alter table public.orcamentos
  add column if not exists parametros jsonb;

-- bdi: imputados de imprevistos/impostos/margem e o preço
--      de venda resultante (quando o orçamento tiver BDI).
alter table public.orcamentos
  add column if not exists bdi jsonb;

-- -----------------------------------------------------
-- 2) ITENS: etapa, ordem e memória de cálculo
-- -----------------------------------------------------
-- etapa: a qual etapa da obra o item pertence
--        (Fundação, Alvenaria, Pisos, ...).
alter table public.orcamento_itens
  add column if not exists etapa text;

-- posicao: ordem do item dentro do orçamento (0, 1, 2...).
--          NÃO é única: a sincronização atual insere antes de
--          remover, então um índice único quebraria nesse
--          intervalo. Serve para reconstruir a ordem exibida.
alter table public.orcamento_itens
  add column if not exists posicao integer;

-- Observação sobre a memória de cálculo:
--   A coluna `detalhe` (text) JÁ EXISTE na tabela. A partir
--   desta versão o app grava nela um JSON (lista de texto)
--   com o passo a passo de cada item. Não precisa de coluna
--   nova. Leitores antigos apenas ignoram o conteúdo.

-- -----------------------------------------------------
-- 3) Preenche a ordem dos itens JÁ existentes (uma vez).
--    Preserva os que já tiverem posição preenchida.
-- -----------------------------------------------------
with ordenados as (
  select id,
         row_number() over (partition by orcamento_id order by id) - 1 as pos
  from public.orcamento_itens
  where posicao is null
)
update public.orcamento_itens i
   set posicao = o.pos
  from ordenados o
 where i.id = o.id;

-- -----------------------------------------------------
-- 4) Índice NÃO único para acelerar a leitura por orçamento.
-- -----------------------------------------------------
create index if not exists idx_orcamento_itens_orc
  on public.orcamento_itens (orcamento_id, posicao);

-- =====================================================
-- FIM. Nada foi executado. Aplique quando quiser — o app
-- detecta a ausência das colunas e continua funcionando.
-- =====================================================
