-- =====================================================
-- MARIO · MIGRAÇÃO DE INTEGRIDADE: mesmo dono nas tabelas filhas
-- -----------------------------------------------------
-- ⚠️  NÃO EXECUTE SEM AUTORIZAÇÃO. Faça BACKUP antes.
--     Altera apenas TRIGGERS/FUNÇÃO (não apaga dados, não faz backfill).
--
-- POR QUE ISTO EXISTE:
--   As políticas RLS "dono_total" validam que a LINHA tem
--   owner_id = auth.uid(). Mas elas NÃO validam o dono do registro PAI
--   referenciado. Assim, um usuário autenticado poderia criar um filho
--   apontando para a obra/orçamento/material de OUTRO dono.
--
--   Exemplos que este arquivo passa a impedir:
--     - recebimento/gasto/trabalhador/parcela com obra_id de outra obra;
--     - cronograma com obra_id de outra obra;
--     - orcamento com obra_id de outra obra;
--     - orcamento_item com orcamento_id de outro dono;
--     - material_preco com material_id de outro dono;
--     - parcela.recebimento_id apontando para recebimento de outro dono.
--
-- COMO FUNCIONA:
--   Triggers BEFORE INSERT OR UPDATE chamam public.mario_mesmo_dono(),
--   que é SECURITY DEFINER (lê o pai mesmo com RLS) e usa
--   SET search_path = public. Se o dono do filho for diferente do dono do
--   pai, a operação é REJEITADA (erro 42501).
--
--   Os campos são lidos com (to_jsonb(new) ->> 'coluna'), e não como
--   new.coluna. Assim, se uma tabela não tiver uma dessas colunas
--   (o esquema real pode diferir do DDL deste repositório), o valor vira
--   NULL e a checagem é pulada em vez de derrubar a operação.
--   Coluna do pai nula também pula a checagem.
--
-- REQUISITO PRÉVIO IMPORTANTE:
--   Os registros PAI precisam ter owner_id preenchido. Se houver obras/
--   orçamentos/materiais antigos com owner_id NULO (ver o diagnóstico),
--   corrija o dono ANTES de rodar este arquivo — senão um filho novo com
--   dono definido seria bloqueado ao apontar para um pai sem dono.
--
-- OBSERVAÇÃO IMPORTANTE:
--   Esta função é uma VERSÃO AMPLIADA da que existe em
--   supabase_orcamentos_integridade.sql (que só tratava orcamento_itens e
--   materiais_precos). O "create or replace" abaixo substitui aquela por
--   esta. Rode ESTE arquivo; não é necessário rodar o outro depois dele.
--
--   Linhas com owner_id NULADO não são bloqueadas aqui (o RLS já barra
--   o usuário autenticado de inserir sem dono; o service_role é admin).
-- =====================================================

begin;

-- -----------------------------------------------------
-- 1) Função de verificação (SECURITY DEFINER, search_path fixo).
-- -----------------------------------------------------
create or replace function public.mario_mesmo_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eu      uuid;
  ref_id  uuid;
begin
  eu := (to_jsonb(new) ->> 'owner_id')::uuid;

  -- Sem dono definido: não interferimos (RLS cuida do usuário comum).
  if eu is null then
    return new;
  end if;

  -- Item de orcamento -> orcamento
  if tg_table_name = 'orcamento_itens' then
    ref_id := (to_jsonb(new) ->> 'orcamento_id')::uuid;
    if ref_id is not null and not exists (
      select 1 from public.orcamentos o
      where o.id = ref_id and o.owner_id = eu
    ) then
      raise exception 'Item de orcamento com dono diferente do orcamento (%)', ref_id
        using errcode = '42501';
    end if;

  -- Preco -> material
  elsif tg_table_name = 'materiais_precos' then
    ref_id := (to_jsonb(new) ->> 'material_id')::uuid;
    if ref_id is not null and not exists (
      select 1 from public.materiais m
      where m.id = ref_id and m.owner_id = eu
    ) then
      raise exception 'Preco de material com dono diferente do material (%)', ref_id
        using errcode = '42501';
    end if;

  -- Filhos ligados diretamente a uma obra -> obras
  elsif tg_table_name in ('recebimentos', 'gastos', 'trabalhadores',
                           'parcelas', 'cronogramas', 'orcamentos') then
    ref_id := (to_jsonb(new) ->> 'obra_id')::uuid;
    if ref_id is not null and not exists (
      select 1 from public.obras o
      where o.id = ref_id and o.owner_id = eu
    ) then
      raise exception 'Registro % ligado a obra de outro dono (%)', tg_table_name, ref_id
        using errcode = '42501';
    end if;
  end if;

  -- Parcela -> recebimento (quando informado)
  if tg_table_name = 'parcelas' then
    ref_id := (to_jsonb(new) ->> 'recebimento_id')::uuid;
    if ref_id is not null and not exists (
      select 1 from public.recebimentos r
      where r.id = ref_id and r.owner_id = eu
    ) then
      raise exception 'Parcela ligada a recebimento de outro dono (%)', ref_id
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Endurecimento: função SECURITY DEFINER não deve ser executável por
-- qualquer papel. Triggers a executam sem precisar de EXECUTE do chamador.
-- OBS.: a criação do gatilho logo abaixo exige EXECUTE sobre a função.
--   No SQL Editor do Supabase você é `postgres` (superusuário), que ignora
--   a checagem de privilégio — por isso este revoke não quebra nada ali.
revoke all on function public.mario_mesmo_dono() from public;
revoke all on function public.mario_mesmo_dono() from anon;

-- -----------------------------------------------------
-- 2) Gatilhos nas tabelas filhas (idempotente e tolerante a
--    tabela ausente: usa to_regclass, não quebra a transação).
--    "orcamentos" é tratado como filho de obras (obra_id -> obras.id).
-- -----------------------------------------------------
do $$
declare
  t text;
  tnome text;
  filhas text[] := array[
    'recebimentos', 'gastos', 'trabalhadores', 'parcelas',
    'cronogramas', 'orcamentos', 'orcamento_itens', 'materiais_precos'
  ];
  pais text[] := array[
    'obras', 'obras', 'obras', 'obras',
    'obras', 'obras', 'orcamentos', 'materiais'
  ];
  i int;
begin
  for i in 1..array_length(filhas, 1) loop
    t := filhas[i];
    if to_regclass(format('public.%I', t)) is null then
      raise notice '[integridade] tabela public.% nao existe (gatilho ignorado)', t;
      continue;
    end if;
    if to_regclass(format('public.%I', pais[i])) is null then
      raise notice '[integridade] tabela-pai public.% nao existe (gatilho de % ignorado)', pais[i], t;
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name::text = pais[i] and column_name = 'owner_id'
    ) then
      raise notice '[integridade] tabela-pai public.% nao tem owner_id (gatilho de % ignorado)', pais[i], t;
      continue;
    end if;
    tnome := 'trg_dono_' || t;
    execute format('drop trigger if exists %I on public.%I', tnome, t);
    execute format(
      'create trigger %I before insert or update on public.%I '
      || 'for each row execute function public.mario_mesmo_dono();', tnome, t);
    raise notice '[integridade] gatilho % criado em public.%', tnome, t;
  end loop;
end $$;

commit;

-- =====================================================
-- Depois de rodar: crie/edite uma obra e seus filhos logado e confirme
-- que continua funcionando. Cada gatilho só barra dono diferente do pai.
-- =====================================================
