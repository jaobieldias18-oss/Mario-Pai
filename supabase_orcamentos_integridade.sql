-- =====================================================
-- MARIO · INTEGRIDADE E IDEMPOTÊNCIA (ARQUIVO SÓ PARA REVISÃO)
-- NÃO EXECUTAR AINDA. Nada aqui é aplicado automaticamente.
-- Idempotente: pode rodar mais de uma vez sem duplicar efeitos.
-- Não usa DROP/DELETE/TRUNCATE de dados.
-- =====================================================
-- Objetivo (auditoria):
--   P3 — impedir que um item seja ligado ao orçamento de OUTRO dono.
--   P2 — permitir gravação idempotente (upsert) e substituição atômica.
--   P5 — apoiar sincronização de edições/exclusões entre aparelhos.
-- =====================================================

-- -----------------------------------------------------
-- 1) GARANTIA DE DONO (triggers)
--    Mesmo um usuário autenticado não pode criar item com
--    orcamento_id de outro dono, nem preço de material alheio.
--    (RLS sozinho valida auth.uid() = owner_id DA LINHA, mas não
--    o dono do registro pai referenciado.)
-- -----------------------------------------------------

create or replace function public.mario_mesmo_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- orcamento_itens -> orcamentos
  if tg_table_name = 'orcamento_itens' then
    if not exists (
      select 1 from public.orcamentos o
      where o.id = new.orcamento_id
        and o.owner_id = new.owner_id
    ) then
      raise exception 'Item de orçamento com dono diferente do orçamento (%)', new.orcamento_id
        using errcode = '42501';
    end if;
  end if;
  -- materiais_precos -> materiais
  if tg_table_name = 'materiais_precos' then
    if not exists (
      select 1 from public.materiais m
      where m.id = new.material_id
        and m.owner_id = new.owner_id
    ) then
      raise exception 'Preço de material com dono diferente do material (%)', new.material_id
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dono_orcamento_itens on public.orcamento_itens;
create trigger trg_dono_orcamento_itens
  before insert or update on public.orcamento_itens
  for each row execute function public.mario_mesmo_dono();

drop trigger if exists trg_dono_materiais_precos on public.materiais_precos;
create trigger trg_dono_materiais_precos
  before insert or update on public.materiais_precos
  for each row execute function public.mario_mesmo_dono();

-- -----------------------------------------------------
-- 2) CHAVES PARA UPSERT IDEMPOTENTE (sem duplicar)
--    Não apaga nada: só impede duplicatas futuras.
-- -----------------------------------------------------

-- Preços: mesma compra (material + data + valor + fonte) não duplica.
-- COALESCE evita o problema de NULL no índice único.
create unique index if not exists uq_materiais_precos_compra
  on public.materiais_precos (
    material_id, data, preco, COALESCE(fonte, '')
  );

-- Itens: posição do item dentro do orçamento (estável para upsert).
alter table public.orcamento_itens
  add column if not exists posicao integer;

-- Preenche a posição de forma ÚNICA por orçamento (não usar 0 para todos,
-- senão o índice único abaixo falharia). Preserva os já preenchidos.
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

create unique index if not exists uq_orcamento_itens_posicao
  on public.orcamento_itens (orcamento_id, posicao);

-- -----------------------------------------------------
-- 3) SUBSTITUIÇÃO ATÔMICA (opcional, para o app usar quando quiser)
--    Troca TODOS os itens de um orçamento numa única transação:
--    ou grava tudo, ou não grava nada. Evita o padrão
--    "apagar antes de inserir" e qualquer perda em falha parcial.
--    Aceita um JSON: [{"nome":..,"quantidade":..,"unidade":..,
--                      "preco":..,"total":..}, ...]
-- -----------------------------------------------------
create or replace function public.mario_salvar_itens(p_orcamento uuid, p_itens jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dono uuid;
begin
  select owner_id into v_dono from public.orcamentos where id = p_orcamento;
  if v_dono is null then
    raise exception 'Orçamento inexistente: %', p_orcamento using errcode = '42501';
  end if;
  if v_dono <> auth.uid() then
    raise exception 'Sem permissão para o orçamento %', p_orcamento using errcode = '42501';
  end if;

  delete from public.orcamento_itens where orcamento_id = p_orcamento;

  insert into public.orcamento_itens
    (owner_id, orcamento_id, posicao, nome, quantidade, unidade, preco, total, detalhe)
  select
    v_dono, p_orcamento, (ord - 1),
    elem->>'nome',
    (elem->>'quantidade')::numeric,
    elem->>'unidade',
    (elem->>'preco')::numeric,
    (elem->>'total')::numeric,
    elem->>'detalhe'
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as t(elem, ord);
end;
$$;

-- -----------------------------------------------------
-- 4) APOIO À SINCRONIZAÇÃO ENTRE APARELHOS (P5) — OPCIONAL
--    As colunas abaixo permitem um "pull incremental" e a
--    identificação SEGURA de exclusões (soft delete), sem
--    apagar dados de verdade.
--    Elas NÃO são obrigatórias para o funcionamento atual.
-- -----------------------------------------------------
alter table public.materiais        add column if not exists updated_at timestamptz not null default now();
alter table public.materiais        add column if not exists removido    boolean not null default false;
alter table public.orcamentos       add column if not exists updated_at  timestamptz not null default now();
alter table public.orcamentos       add column if not exists removido    boolean not null default false;

create or replace function public.mario_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_materiais on public.materiais;
create trigger trg_touch_materiais
  before update on public.materiais
  for each row execute function public.mario_touch();

drop trigger if exists trg_touch_orcamentos on public.orcamentos;
create trigger trg_touch_orcamentos
  before update on public.orcamentos
  for each row execute function public.mario_touch();

-- =====================================================
-- FIM. Nada foi executado. Revise com calma antes de aplicar.
-- =====================================================
