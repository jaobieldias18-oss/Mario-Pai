-- ============================================================================
-- MARIO · DIAGNÓSTICO DE ORÇAMENTOS (SOMENTE LEITURA)
-- ----------------------------------------------------------------------------
-- Objetivo: verificar se o banco Supabase está pronto para receber a migração
--           supabase_orcamentos_persistencia.sql.
--
-- SEGURANÇA:
--   * Só usa SELECT sobre catálogos (information_schema / pg_catalog) e
--     funções de leitura (has_table_privilege, pg_get_indexdef, aclexplode).
--   * NÃO altera nada: sem INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/GRANT/REVOKE.
--   * NÃO usa DO / EXECUTE / SQL dinâmico.
--   * Seguro para rodar a qualquer momento.
--
-- COMO USAR:
--   1. Cole este arquivo no SQL Editor do Supabase e clique Run.
--   2. Rode as seções 1 a 7 de uma vez (ou selecione e rode individualmente).
--   3. Rode a seção 8a. SÓ rode a seção 8b se a 8a indicar posicao_existe = true.
--   Rode como dono do projeto (postgres) para enxergar todos os metadados.
-- ============================================================================


-- ── 1) As tabelas existem? ─────────────────────────────────────────────────
select '1-tabelas' as secao,
       n.nspname  as schema,
       c.relname  as objeto,
       case c.relkind
         when 'r' then 'tabela'
         when 'p' then 'tabela_part'
         else c.relkind::text
       end as tipo,
       c.relrowsecurity       as rls_ligado,
       c.relforcerowsecurity  as rls_forcado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('orcamentos', 'orcamento_itens')
order by c.relname;


-- ── 2) Colunas e tipos (todas as colunas das duas tabelas) ─────────────────
select '2-colunas' as secao,
       table_name, ordinal_position, column_name,
       data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('orcamentos', 'orcamento_itens')
order by table_name, ordinal_position;


-- ── 3) Chaves estrangeiras que envolvem essas tabelas ──────────────────────
select '3-fks' as secao,
       tc.table_name     as tabela_filha,
       kcu.column_name   as coluna_filha,
       ccu.table_name    as tabela_pai,
       ccu.column_name   as coluna_pai,
       rc.delete_rule    as ao_apagar,
       rc.update_rule    as ao_atualizar,
       tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
     on kcu.constraint_name = tc.constraint_name
    and kcu.table_schema    = tc.table_schema
join information_schema.constraint_column_usage ccu
     on ccu.constraint_name = tc.constraint_name
    and ccu.table_schema    = tc.table_schema
join information_schema.referential_constraints rc
     on rc.constraint_name   = tc.constraint_name
    and rc.constraint_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in ('orcamentos', 'orcamento_itens')
order by tc.table_name, tc.constraint_name;


-- ── 4) Índices (marca quais são ÚNICOS) ────────────────────────────────────
-- Atenção especial a índices ÚNICOS em (orcamento_id, posicao):
-- eles quebrariam a sincronização "insere-antes-de-apagar" do app (erro 23505).
select '4-indices' as secao,
       t.relname       as tabela,
       i.relname       as indice,
       ix.indisunique  as unico,
       ix.indisprimary as chave_primaria,
       pg_get_indexdef(ix.indexrelid) as definicao
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('orcamentos', 'orcamento_itens')
order by t.relname, i.relname;


-- ── 5) Políticas RLS ativas nessas tabelas ─────────────────────────────────
select '5-politicas' as secao,
       tablename  as tabela,
       policyname as politica,
       permissive, roles, cmd as operacao,
       qual       as usando,
       with_check as checando
from pg_policies
where schemaname = 'public'
  and tablename in ('orcamentos', 'orcamento_itens')
order by tablename, policyname;


-- ── 6a) Privilégios na ACL da tabela (o que está explicitamente concedido) ─
select '6a-acl' as secao,
       c.relname as tabela,
       coalesce(r.rolname, 'PUBLIC') as papel,
       a.privilege_type as privilegio
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and c.relname in ('orcamentos', 'orcamento_itens')
order by tabela, papel, privilegio;


-- ── 6b) Privilégio EFETIVO para anon / authenticated / service_role ────────
select '6b-priv-efetivo' as secao,
       v.t as tabela,
       p.p as papel,
       has_table_privilege(p.p, format('public.%I', v.t), 'SELECT') as select_ok,
       has_table_privilege(p.p, format('public.%I', v.t), 'INSERT') as insert_ok,
       has_table_privilege(p.p, format('public.%I', v.t), 'UPDATE') as update_ok,
       has_table_privilege(p.p, format('public.%I', v.t), 'DELETE') as delete_ok
from (values ('orcamentos'), ('orcamento_itens')) v(t)
cross join (values ('anon'), ('authenticated'), ('service_role')) p(p)
order by tabela, papel;


-- ── 7) Resumo de compatibilidade (uma linha) ───────────────────────────────
select '7-resumo' as secao,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('orcamentos', 'orcamento_itens'))            as tabelas_presentes,

  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamentos'
      and column_name = 'id')                                         as orc_id_tipo,
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamento_itens'
      and column_name = 'orcamento_id')                               as item_orc_id_tipo,
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamento_itens'
      and column_name = 'detalhe')                                    as item_detalhe_tipo,

  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamentos'
      and column_name = 'parametros')                                 as orc_tem_parametros,
  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamentos'
      and column_name = 'bdi')                                        as orc_tem_bdi,
  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamento_itens'
      and column_name = 'etapa')                                      as itens_tem_etapa,
  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamento_itens'
      and column_name = 'posicao')                                    as itens_tem_posicao,

  exists(
    select 1
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'orcamento_itens'
      and ix.indisunique
      and pg_get_indexdef(ix.indexrelid) ilike '%orcamento_id%'
      and pg_get_indexdef(ix.indexrelid) ilike '%posicao%'
  ) as existe_indice_unico_posicao;


-- ============================================================================
-- SEÇÃO 8 — verificação de posições duplicadas (SEGURA, em duas partes)
-- ----------------------------------------------------------------------------
-- Uma consulta estática NÃO pode citar a coluna posicao se ela ainda não
-- existir: o Postgres valida os nomes de coluna no parse/planejamento, então
-- um CASE/guarda não evitaria o erro. Por isso: 8a (metadado, sempre segura)
-- e 8b (a checagem real), rodada manualmente SÓ se 8a confirmar que existe.
-- ============================================================================

-- ── 8a) A coluna posicao já existe? (metadado — SEMPRE segura) ─────────────
-- Rode esta primeiro. Ela NUNCA falha, exista ou não a coluna.
select '8a-coluna-posicao' as secao,
       exists(
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'orcamento_itens'
           and column_name  = 'posicao'
       ) as posicao_existe,
       coalesce(
         (select data_type from information_schema.columns
           where table_schema = 'public'
             and table_name   = 'orcamento_itens'
             and column_name  = 'posicao'),
         '—'
       ) as posicao_tipo,
       case
         when exists(
           select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name   = 'orcamento_itens'
             and column_name  = 'posicao')
         then 'COLUNA EXISTE: rode a seção 8b para ver posições duplicadas.'
         else 'COLUNA AUSENTE: verificação de duplicadas IGNORADA (a migração criará a coluna posicao).'
       end as instrucao;


-- ── 8b) Posições duplicadas por orçamento ─────────────────────────────────
-- RODE SOMENTE SE a seção 8a retornar posicao_existe = true.
-- Se posicao_existe = false, NÃO rode esta consulta (ela falharia por
-- referenciar uma coluna inexistente) — não há o que verificar ainda.
select '8b-posicoes-duplicadas' as secao,
       orcamento_id, posicao, count(*) as vezes
from public.orcamento_itens
where posicao is not null
group by orcamento_id, posicao
having count(*) > 1
order by vezes desc
limit 50;


-- ============================================================================
-- FIM DO DIAGNÓSTICO. Nenhuma linha foi alterada.
-- ============================================================================
