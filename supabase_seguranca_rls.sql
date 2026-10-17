-- =====================================================
-- MARIO · SEGURANÇA — fechamento do acesso anônimo (RLS)
-- =====================================================
-- PROBLEMA: as migrações anteriores (supabase.sql seção 8 e
-- supabase_orcamento_pro.sql) criaram a política "anon_total"
-- (for all to anon using (true)) e concederam acesso à chave
-- pública. Com isso, QUALQUER pessoa de posse da URL + chave
-- publicável consegue LER, ALTERAR e APAGAR os dados.
--
-- O app agora EXIGE LOGIN (conta única do Mário) e envia
-- owner_id = auth.uid() em toda linha. Portanto o acesso anônimo
-- não é mais necessário e deve ser removido.
--
-- COMO RODAR (uma vez, quando autorizado):
--   supabase db query --linked --project-ref wmcrbjlzsqveekwifded < supabase_seguranca_rls.sql
--   (ou cole o conteúdo no SQL Editor do painel Supabase)
--
-- SEGURO/IDEMPOTENTE: pode rodar mais de uma vez. Não apaga
-- tabelas nem colunas. Faz BACKFILL de owner_id (linhas antigas
-- sem dono passam a pertencer à conta do Mário) antes de fechar.
-- =====================================================

-- 1. BACKFILL: linhas criadas antes do login (owner_id nulo) passam a
--    pertencer à conta única. Assim os dados continuam visíveis para
--    o dono depois do fechamento — sem perda.
do $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where email = 'mario@mario.local' limit 1;
  if v_uid is not null then
    update public.obras          set owner_id = v_uid where owner_id is null;
    update public.recebimentos   set owner_id = v_uid where owner_id is null;
    update public.gastos         set owner_id = v_uid where owner_id is null;
    update public.trabalhadores  set owner_id = v_uid where owner_id is null;
    update public.parcelas       set owner_id = v_uid where owner_id is null;
  end if;
end $$;

-- 2. REMOVE a política anônima aberta em TODAS as tabelas conhecidas.
do $$
declare
  t text;
  tabelas text[] := array[
    'obras', 'recebimentos', 'gastos', 'trabalhadores', 'parcelas',
    'orc_catalogo_tecnico', 'orc_cotacoes', 'orc_fornecedores',
    'orc_obras_reais', 'orc_medicoes'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "anon_total" on public.%I', t);
      execute format('drop policy if exists "anon_leitura" on public.%I', t);
      execute format('drop policy if exists "anon_escrita" on public.%I', t);
    end if;
  end loop;
end $$;

-- 3. GARANTE a política do dono (authenticated) em todas as tabelas.
--    (idempotente: recria a "dono_total")
do $$
declare
  t text;
  tabelas text[] := array[
    'obras', 'recebimentos', 'gastos', 'trabalhadores', 'parcelas',
    'orc_catalogo_tecnico', 'orc_cotacoes', 'orc_fornecedores',
    'orc_obras_reais', 'orc_medicoes'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "dono_total" on public.%I', t);
      execute format(
        'create policy "dono_total" on public.%I for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id)',
        t);
    end if;
  end loop;
end $$;

-- 4. REVOGA o acesso anônimo (a chave publicável deixa de operar).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- 5. Conferência (deve listar ZERO políticas com role anon).
--    select tablename, policyname, roles from pg_policies
--    where schemaname = 'public' and 'anon' = any(roles);
