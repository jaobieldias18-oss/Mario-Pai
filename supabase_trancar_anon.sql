-- =====================================================
-- MARIO · MIGRAÇÃO DE SEGURANÇA: trancar o papel anon
-- -----------------------------------------------------
-- ⚠️  NÃO EXECUTE ESTE ARQUIVO SEM AUTORIZAÇÃO.
--     Faça BACKUP antes. Ele altera PERMISSÕES e POLÍTICAS
--     (não apaga dados e não faz backfill de dono).
--
-- POR QUE ISTO EXISTE:
--   Os arquivos supabase.sql e supabase_orcamentos.sql concedem ao
--   papel "anon" leitura E escrita em todas as tabelas
--   (policy "anon_total" com using(true) + "grant ... to anon").
--   Como a chave publicável fica no site (que é público), qualquer
--   pessoa poderia ler/alterar TODOS os dados. O app hoje exige login
--   e filtra por dono, então o anon não é mais necessário.
--
-- O QUE ESTA MIGRAÇÃO FAZ (tudo idempotente; pode rodar de novo):
--   1. Em cada tabela, REMOVE qualquer política cujo papel seja
--      anon ou public (qualquer nome — não presume que se chama
--      "anon_total"; cobre nomes desconhecidos que existam no banco).
--   2. REVOGA todos os privilégios de anon E de PUBLIC nessas tabelas.
--   3. GARANTE o RLS ligado.
--   4. RECRIA a política do dono para o usuário autenticado:
--         "dono_total" FOR ALL TO authenticated
--         USING (auth.uid() = owner_id)
--         WITH CHECK (auth.uid() = owner_id)
--      -> Vale para SELECT (using), DELETE (using),
--         INSERT (with check) e UPDATE (using + with check).
--         Ou seja: só enxerga/escreve linhas com owner_id = usuário logado.
--      (Só é criada se a tabela tiver a coluna owner_id.)
--   5. Impede que tabelas/sequências/funções FUTURAS já nasçam abertas
--      para o anon (default privileges) e tira o anon do schema/funções.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ (de propósito):
--   - NÃO faz backfill de owner_id nulo. Se existirem registros sem dono,
--     use primeiro supabase_diagnostico_seguranca.sql, confirme o dono
--     (a conta mario@mario.local) e só então corrija, com backup.
--   - NÃO mexe em dados, NÃO cria/remove tabelas/colunas, NÃO toca em
--     secrets. NÃO altera a coluna owner_id (não a torna obrigatória).
--
-- ORDEM RECOMENDADA:
--   1) BACKUP.
--   2) Rodar o diagnóstico (leitura) e conferir nulos/políticas.
--   3) Corrigir owner_id nulo (se houver), com o UID confirmado.
--   4) Rodar ESTE arquivo.
--   5) Rodar supabase_integridade_donos.sql.
--   6) Testar login e ver os dados aparecerem; conferir que anon não lê mais.
--
-- OBSERVAÇÃO (IA): a Edge Function ia-financeira lê as tabelas usando
--   SUPABASE_SERVICE_ROLE_KEY (padrão no ambiente de Edge Functions). Se
--   essa chave NÃO existir, ela cai para a chave anon e, após trancar o
--   anon, deixaria de ler. Confirme que o secret do service_role existe
--   (ele é fornecido por padrão pelo Supabase).
-- =====================================================

begin;

do $$
declare
  t text;
  r record;
  tem_owner boolean;
  tabelas text[] := array[
    'obras', 'recebimentos', 'gastos', 'trabalhadores', 'parcelas',
    'materiais', 'materiais_precos', 'orcamentos', 'orcamento_itens',
    'fornecedores', 'cronogramas'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice '[trancar_anon] tabela public.% ainda nao existe (ignorada)', t;
      continue;
    end if;

    -- (1) Remove QUALQUER política com papel anon ou public.
    for r in
      select policyname, roles
      from pg_policies
      where schemaname = 'public' and tablename::text = t
    loop
      if 'anon' = any(r.roles) or 'public' = any(r.roles) then
        execute format('drop policy if exists %I on public.%I', r.policyname::text, t);
        raise notice '[trancar_anon] politica removida: %.% (papeis: %)',
          t, r.policyname, array_to_string(r.roles, ',');
      end if;
    end loop;

    -- (2) Revoga privilégios de anon e de PUBLIC nesta tabela.
    execute format('revoke all on public.%I from anon;', t);
    execute format('revoke all on public.%I from public;', t);

    -- (3) Garante RLS ligado.
    execute format('alter table public.%I enable row level security;', t);

    -- (4) Recria a política do dono — só se a coluna owner_id existir.
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'owner_id'
    ) into tem_owner;

    if tem_owner then
      execute format('drop policy if exists "dono_total" on public.%I;', t);
      execute format(
        'create policy "dono_total" on public.%I for all to authenticated '
        || 'using (auth.uid() = owner_id) '
        || 'with check (auth.uid() = owner_id);', t);
    else
      raise notice '[trancar_anon] public.% NAO tem owner_id: policy do dono nao criada', t;
    end if;

    -- (5) Garante que o autenticado continua podendo ler/escrever a tabela.
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated;', t);

    raise notice '[trancar_anon] public.% : anon travado, dono garantido', t;
  end loop;
end $$;

-- Schema e funções: o anon não precisa de nada.
revoke usage on schema public from anon;
revoke execute on all functions in schema public from anon;
-- Reforço global: tabelas e sequências do schema.
revoke select, insert, update, delete on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- O autenticado precisa de usage no schema para acessar as tabelas.
grant usage on schema public to authenticated;

-- Objetos FUTUROS criados pelo dono do schema não nascem abertos p/ anon.
alter default privileges in schema public
  revoke select, insert, update, delete on tables from anon;
alter default privileges in schema public
  revoke usage, select on sequences from anon;
alter default privileges in schema public
  revoke execute on functions from anon;

commit;

-- =====================================================
-- Depois de rodar:
--   * Abra o app logado e confirme que os dados aparecem.
--   * Rode supabase_diagnostico_seguranca.sql de novo: o anon não deve
--     ter privilégios nem políticas.
--   * Se precisar reverter, reaplique supabase.sql/supabase_orcamentos.sql
--     (isso REABRE o anon — evite).
-- =====================================================
