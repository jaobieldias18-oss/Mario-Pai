-- =====================================================
-- MARIO · Controle de Obras — estrutura Supabase
-- ETAPA 3 da migração localStorage → Supabase
-- -----------------------------------------------------
-- Como executar: cole este arquivo no SQL Editor do
-- Supabase (ou rode via conexão direta postgres).
-- É idempotente: pode rodar mais de uma vez sem duplicar.
--
-- Espelho do localStorage antigo (chave controle_obras_v1):
--   obra           → public.obras
--   recebimentos[] → public.recebimentos (obra_id)
--   gastos[]       → public.gastos (obra_id + mao_obra_id)
--   equipe[]       → public.trabalhadores (obra_id)
-- O elo mão-de-obra→gasto (maoObraId) vira mao_obra_id.
-- =====================================================

-- 1. Função que mantém updated_at automático em obras
create or replace function public.atualizar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. OBRAS
create table if not exists public.obras (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  cliente text not null,
  endereco text,
  valor_contratado numeric(14, 2) not null default 0,
  data_inicio date,
  previsao_termino date,
  status text not null default 'Em andamento',
  data_encerramento date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_obras_updated on public.obras;
create trigger trg_obras_updated
  before update on public.obras
  for each row execute function public.atualizar_updated_at();

-- 3. RECEBIMENTOS (um por linha, ligado à obra)
create table if not exists public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  obra_id uuid not null references public.obras (id) on delete cascade,
  valor numeric(14, 2) not null default 0,
  data date not null,
  descricao text not null,
  forma_pagamento text,
  observacao text,
  created_at timestamptz not null default now()
);

-- 4. GASTOS (um por linha, ligado à obra)
-- mao_obra_id = elo com o trabalhador (sem FK: a exclusão
-- é feita pelo app, junto com o trabalhador — igual ao
-- comportamento atual do campo maoObraId no localStorage)
create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  obra_id uuid not null references public.obras (id) on delete cascade,
  categoria text not null,
  descricao text not null,
  valor numeric(14, 2) not null default 0,
  data date not null,
  observacao text,
  mao_obra_id uuid,
  created_at timestamptz not null default now()
);

-- 5. TRABALHADORES (mão de obra, ligada à obra)
create table if not exists public.trabalhadores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  obra_id uuid not null references public.obras (id) on delete cascade,
  nome text not null,
  funcao text not null,
  diaria numeric(14, 2) not null default 0,
  dias_trabalhados integer not null default 0,
  created_at timestamptz not null default now()
);

-- 6. Índices (listas por obra e filtro por data do financeiro)
create index if not exists idx_obras_owner on public.obras (owner_id);
create index if not exists idx_recebimentos_obra on public.recebimentos (obra_id);
create index if not exists idx_gastos_obra on public.gastos (obra_id);
create index if not exists idx_trabalhadores_obra on public.trabalhadores (obra_id);
create index if not exists idx_recebimentos_data on public.recebimentos (data);
create index if not exists idx_gastos_data on public.gastos (data);

-- 7. RLS: cada usuário autenticado só toca nos PRÓPRIOS dados
alter table public.obras enable row level security;
alter table public.recebimentos enable row level security;
alter table public.gastos enable row level security;
alter table public.trabalhadores enable row level security;

drop policy if exists "dono_total" on public.obras;
create policy "dono_total" on public.obras
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "dono_total" on public.recebimentos;
create policy "dono_total" on public.recebimentos
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "dono_total" on public.gastos;
create policy "dono_total" on public.gastos
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "dono_total" on public.trabalhadores;
create policy "dono_total" on public.trabalhadores
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
