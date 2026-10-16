-- =====================================================
-- MARIO · DIAGNÓSTICO DE SEGURANÇA (SOMENTE LEITURA)
-- -----------------------------------------------------
-- NÃO ALTERA NADA. Só consulta. Seguro para rodar a qualquer momento.
-- Como usar: cole no SQL Editor do Supabase e clique Run.
--   - As consultas A–D devolvem tabelas de resultado.
--   - O bloco E escreve avisos na aba "Notices" (mensagens).
--
-- Para que serve:
--   A) Ver se o RLS está ligado em cada tabela.
--   B) Ver as políticas que REALMENTE existem no banco (podem ser
--      diferentes das do repositório — nunca presuma que são iguais).
--   C) Ver o que os papéis anon/authenticated podem fazer nas tabelas.
--   D) Ver os privilégios PADRÃO (o que tabelas futuras herdam).
--   E) Contar registros SEM dono (owner_id nulo) — sem corrigir nada.
-- =====================================================

-- -----------------------------------------------------
-- A) RLS ligado?  (rls_ligado deve ser true em todas as tabelas)
-- -----------------------------------------------------
select c.relname as tabela,
       c.relrowsecurity  as rls_ligado,
       c.relforcerowsecurity as rls_forcado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname;

-- -----------------------------------------------------
-- B) Políticas existentes (procure QUALQUER política cujo
--    campo "roles" contenha anon ou public — são as perigosas)
-- -----------------------------------------------------
select tablename as tabela,
       policyname as politica,
       roles,
       cmd as operacao,
       qual as usando,
       with_check as checando
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- -----------------------------------------------------
-- C) Privilégios de tabela por papel (anon não deveria
--    aparecer; authenticated deve ter as 4 operações)
-- -----------------------------------------------------
select table_name as tabela,
       grantee as papel,
       string_agg(distinct privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
group by table_name, grantee
order by table_name, grantee;

-- -----------------------------------------------------
-- D) Privilégios PADRÃO (o que tabelas futuras herdam).
--    Não deve haver linha com anon em defaclacl.
-- -----------------------------------------------------
select defaclrole::regrole      as papel_doador,
       defaclnamespace::regnamespace as schema,
       defaclobjtype            as tipo_objeto,
       defaclacl                as privilegios_padrao
from pg_default_acl;

-- -----------------------------------------------------
-- D2) Funções do schema public (execute de anon/PUBLIC e se são
--     SECURITY DEFINER). Nenhuma função do app precisa de anon.
-- -----------------------------------------------------
select p.proname        as funcao,
       p.prosecdef      as security_definer,
       p.proacl         as privilegios_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- -----------------------------------------------------
-- E) Registros com owner_id NULO (apenas conta; não corrige).
--    Leia os avisos na aba "Notices" do SQL Editor.
--    Se houver nulos, o app logado NÃO os verá (o RLS filtra por dono).
-- -----------------------------------------------------
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'obras', 'recebimentos', 'gastos', 'trabalhadores', 'parcelas',
    'materiais', 'materiais_precos', 'orcamentos', 'orcamento_itens',
    'fornecedores', 'cronogramas'
  ] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice '[diagnostico] tabela % : NAO EXISTE', t;
    elsif not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name::text = t and column_name = 'owner_id'
    ) then
      raise notice '[diagnostico] tabela % : SEM coluna owner_id (contagem ignorada)', t;
    else
      execute format('select count(*) from public.%I where owner_id is null', t) into n;
      raise notice '[diagnostico] tabela % : % registro(s) com owner_id NULO', t, n;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------
-- F) AMOSTRA de registros sem dono (só para conferência manual).
--    Troque <tabela> por uma que apareceu com nulos no passo E.
--    Nada é alterado; apenas leitura.
-- -----------------------------------------------------
-- select id, obra_id, created_at
-- from public.<tabela>
-- where owner_id is null
-- order by created_at
-- limit 20;

-- -----------------------------------------------------
-- G) COMO CONFIRMAR O PROPRIETÁRIO (somente leitura).
--    Neste projeto existe UMA conta (mario@mario.local). Confirme o id
--    dela e compare com os registros sem dono (datas, obras, valores)
--    ANTES de qualquer correção. NÃO atribua registros ao "primeiro
--    usuário encontrado" automaticamente.
-- -----------------------------------------------------
-- select id, email, created_at from auth.users order by created_at;

-- -----------------------------------------------------
-- H) CORREÇÃO DOS NULOS (NÃO faz parte deste diagnóstico).
--    Só execute DEPOIS de confirmar o dono e fazer BACKUP, com o id
--    real no lugar de '<UID_CONFIRMADO>'. Exemplo (mantido comentado
--    de propósito — este arquivo é somente leitura):
-- -----------------------------------------------------
-- update public.obras         set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.recebimentos  set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.gastos        set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.trabalhadores set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.parcelas      set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.materiais     set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.materiais_precos set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.orcamentos    set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.orcamento_itens set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.fornecedores  set owner_id = '<UID_CONFIRMADO>' where owner_id is null;
-- update public.cronogramas   set owner_id = '<UID_CONFIRMADO>' where owner_id is null;

-- =====================================================
-- FIM DO DIAGNÓSTICO. Nenhuma linha foi alterada.
-- =====================================================
