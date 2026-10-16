-- =====================================================
-- MARIO · Migração ADITIVA do modo profissional do orçamento
-- -----------------------------------------------------
-- NÃO APLICAR automaticamente. Este arquivo apenas CRIA tabelas
-- novas; não altera nem remove nada existente.
--
-- Tabelas espelham os módulos locais de orcamento_pro.js:
--   orc_catalogo_tecnico  ← catálogo técnico (código, unidade, rendimento, fonte)
--   orc_cotacoes          ← histórico de preços/cotações por fornecedor
--   orc_fornecedores      ← cadastro de fornecedores
--   orc_obras_reais       ← previsto × comprado × realizado (comparação manual)
--   orc_medicoes          ← medições por ambiente/parede (opcional, backup)
--
-- Padrão de segurança: idêntico ao RESTANTE do app (owner_id + RLS + anon
-- liberado porque o app não usa login obrigatório — decisão do dono).
--
-- Como aplicar (SOMENTE quando autorizado):
--   supabase db execute --project-ref wmcrbjlzsqveekwifded --file supabase_orcamento_pro.sql
-- =====================================================

-- ---------- Catálogo técnico ----------
create table if not exists public.orc_catalogo_tecnico (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text not null,
  codigo text not null,
  nome text not null,
  categoria text,
  unidade_compra text,
  unidade_consumo text,
  conversoes jsonb not null default '[]'::jsonb,
  dimensoes text,
  rendimento_valor numeric,
  rendimento_unidade text,
  rendimento_obs text,
  perda numeric,
  composicao text,
  fonte text,
  data_ref date,
  conf smallint,
  limitacao text,
  ativo boolean not null default true,
  obs text,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);
create index if not exists idx_orc_cat_codigo on public.orc_catalogo_tecnico (codigo);

-- ---------- Cotação de preço ----------
create table if not exists public.orc_cotacoes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text not null,
  codigo text not null,
  fornecedor text,
  preco numeric not null,
  unidade text,
  tipo text not null default 'estimativa',  -- confirmado | historico | estimativa
  data date,
  localidade text,
  obra_id uuid references public.obras(id) on delete set null,
  obs text,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);
create index if not exists idx_orc_cot_codigo on public.orc_cotacoes (codigo);

-- ---------- Fornecedores (modo profissional) ----------
create table if not exists public.orc_fornecedores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text not null,
  nome text not null,
  telefone text,
  cidade text,
  categoria text,
  obs text,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

-- ---------- Obras reais (previsto × comprado × realizado) ----------
create table if not exists public.orc_obras_reais (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text not null,
  obra_id uuid references public.obras(id) on delete set null,
  nome text,
  codigo text,
  etapa text,
  qtd_prevista numeric,
  qtd_comprada numeric,
  qtd_usada numeric,
  custo_previsto numeric,
  custo_realizado numeric,
  justificativa text,
  data date,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

-- ---------- Medições por ambiente/parede ----------
create table if not exists public.orc_medicoes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text not null,
  obra_id uuid references public.obras(id) on delete set null,
  ambientes jsonb not null default '[]'::jsonb,
  paredes jsonb not null default '[]'::jsonb,
  liquida numeric,
  piso_total numeric,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

-- ---------- RLS (mesmo padrão do app) ----------
alter table public.orc_catalogo_tecnico enable row level security;
alter table public.orc_cotacoes enable row level security;
alter table public.orc_fornecedores enable row level security;
alter table public.orc_obras_reais enable row level security;
alter table public.orc_medicoes enable row level security;

-- Dono autenticado
drop policy if exists "dono_total" on public.orc_catalogo_tecnico;
create policy "dono_total" on public.orc_catalogo_tecnico for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.orc_cotacoes;
create policy "dono_total" on public.orc_cotacoes for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.orc_fornecedores;
create policy "dono_total" on public.orc_fornecedores for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.orc_obras_reais;
create policy "dono_total" on public.orc_obras_reais for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.orc_medicoes;
create policy "dono_total" on public.orc_medicoes for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- App sem login obrigatório: anon liberado como nas demais tabelas
grant usage on schema public to anon;
grant select, insert, update, delete on public.orc_catalogo_tecnico to anon;
grant select, insert, update, delete on public.orc_cotacoes to anon;
grant select, insert, update, delete on public.orc_fornecedores to anon;
grant select, insert, update, delete on public.orc_obras_reais to anon;
grant select, insert, update, delete on public.orc_medicoes to anon;
drop policy if exists "anon_total" on public.orc_catalogo_tecnico;
create policy "anon_total" on public.orc_catalogo_tecnico for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.orc_cotacoes;
create policy "anon_total" on public.orc_cotacoes for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.orc_fornecedores;
create policy "anon_total" on public.orc_fornecedores for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.orc_obras_reais;
create policy "anon_total" on public.orc_obras_reais for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.orc_medicoes;
create policy "anon_total" on public.orc_medicoes for all to anon using (true) with check (true);

-- Fim da migração aditiva. Nada existente foi alterado.
