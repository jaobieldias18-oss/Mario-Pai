-- =====================================================
-- MARIO · Orçamentos — tabelas no Supabase
-- Como executar: cole no SQL Editor do projeto e clique Run.
-- Idempotente: pode rodar mais de uma vez sem duplicar.
-- local_id = elo com os registros do aparelho (sem duplicar
-- na sincronização). RLS espelha o padrão do app (anon).
-- =====================================================

-- ---------- MATERIAIS ----------
create table if not exists public.materiais (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text,
  nome text not null,
  categoria text not null default 'Outros',
  marca text,
  unidade text not null default 'un',
  preco numeric(14,2),
  data_preco date,
  fonte text,
  perda numeric(8,4) not null default 0.05,
  consumo numeric(14,4),
  consumo_obs text,
  obs text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);
create index if not exists idx_materiais_cat on public.materiais (categoria);

-- ---------- HISTÓRICO DE PREÇOS (nunca apaga o anterior) ----------
create table if not exists public.materiais_precos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  material_id uuid not null references public.materiais(id) on delete cascade,
  preco numeric(14,2) not null,
  data date not null default CURRENT_DATE,
  fonte text,
  created_at timestamptz not null default now()
);
create index if not exists idx_precos_mat on public.materiais_precos (material_id, data);

-- ---------- ORÇAMENTOS ----------
create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text,
  obra_id uuid references public.obras(id) on delete set null,
  area numeric(14,2) not null default 0,
  alvenaria text not null default 'bloco',
  total numeric(14,2) not null default 0,
  data date not null default CURRENT_DATE,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

-- ---------- ITENS DO ORÇAMENTO (memória de cálculo) ----------
create table if not exists public.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  nome text not null,
  quantidade numeric(14,3),
  unidade text,
  preco numeric(14,2),
  total numeric(14,2),
  detalhe text
);

-- ---------- FORNECEDORES ----------
create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text,
  nome text not null,
  telefone text,
  cidade text,
  categoria text,
  materiais text,
  preco numeric(14,2),
  prazo_entrega text,
  frete numeric(14,2),
  forma_pagamento text,
  observacoes text,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

-- ---------- CRONOGRAMAS ----------
create table if not exists public.cronogramas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  local_id text,
  obra_id uuid references public.obras(id) on delete cascade,
  etapa text not null,
  inicio date,
  previsao_fim date,
  status text not null default 'Pendente',
  observacoes text,
  created_at timestamptz not null default now(),
  unique(owner_id, local_id)
);
create index if not exists idx_cron_obra on public.cronogramas (obra_id);

-- ---------- RLS (mesmo padrão do app) ----------
alter table public.materiais enable row level security;
alter table public.materiais_precos enable row level security;
alter table public.orcamentos enable row level security;
alter table public.orcamento_itens enable row level security;
alter table public.fornecedores enable row level security;
alter table public.cronogramas enable row level security;

-- Leitura/escrita do dono autenticado
drop policy if exists "dono_total" on public.materiais;
create policy "dono_total" on public.materiais for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.materiais_precos;
create policy "dono_total" on public.materiais_precos for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.orcamentos;
create policy "dono_total" on public.orcamentos for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.orcamento_itens;
create policy "dono_total" on public.orcamento_itens for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.fornecedores;
create policy "dono_total" on public.fornecedores for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "dono_total" on public.cronogramas;
create policy "dono_total" on public.cronogramas for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- App sem login (decisão do dono): anon liberado como nas demais tabelas
grant usage on schema public to anon;
grant select, insert, update, delete on public.materiais to anon;
grant select, insert, update, delete on public.materiais_precos to anon;
grant select, insert, update, delete on public.orcamentos to anon;
grant select, insert, update, delete on public.orcamento_itens to anon;
grant select, insert, update, delete on public.fornecedores to anon;
grant select, insert, update, delete on public.cronogramas to anon;
drop policy if exists "anon_total" on public.materiais;
create policy "anon_total" on public.materiais for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.materiais_precos;
create policy "anon_total" on public.materiais_precos for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.orcamentos;
create policy "anon_total" on public.orcamentos for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.orcamento_itens;
create policy "anon_total" on public.orcamento_itens for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.fornecedores;
create policy "anon_total" on public.fornecedores for all to anon using (true) with check (true);
drop policy if exists "anon_total" on public.cronogramas;
create policy "anon_total" on public.cronogramas for all to anon using (true) with check (true);
