\set ON_ERROR_STOP on
set timezone = 'America/Sao_Paulo';

-- ============================================================================
-- Base de clientes de UMA empresa, só quem tem telefone utilizável.
-- Colunas de saída: nome, telefone, cpf, email, nascimento
--
-- Variáveis:  :empresa  slug da empresa
--             :data_br  'sim' -> nascimento DD/MM/AAAA; senão AAAA-MM-DD
--             :sem_optout 'sim' -> deixa de fora quem pediu pra não receber
--                          marketing (opt_out_marketing)
--
-- As duas views temporárias são a única coisa aqui que precisa de transação
-- escrevível, e nenhuma delas toca tabela de verdade: existem pra que a regra
-- do telefone seja escrita UMA vez e as contagens saiam do mesmo lugar que o
-- CSV. Logo depois delas a sessão vira somente-leitura.
-- ============================================================================

create temporary view v_pessoas as
with org as (
  select id from organizations where slug = :'empresa'
),
-- os três telefones de cada cliente, na ordem de preferência
candidatos as (
  select c.id, t.ord, regexp_replace(coalesce(t.fone, ''), '\D', '', 'g') as d
    from customers c
    join org o on o.id = c.organization_id
    cross join lateral (values (1, c.phone), (2, c.whatsapp_phone), (3, c.phone_secondary)) as t(ord, fone)
   where c.deleted_at is null
),
-- normaliza e descarta o que não tem cara de telefone brasileiro: 10 ou 11
-- dígitos, não começa com 0, não é o mesmo dígito repetido. O 55 do país sai
-- quando sobra DDD+número. Telefone inventado no destino é pior que ausente.
limpos as (
  select id, ord,
         case
           when length(d) in (10, 11) then d
           when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
           else null
         end as tel
    from candidatos
),
validos as (
  select id, ord, tel from limpos
   where tel is not null and length(tel) in (10, 11)
     and left(tel, 1) <> '0' and tel !~ '^(.)\1+$'
),
escolhido as (
  select id, (array_agg(tel order by ord))[1] as telefone from validos group by id
),
pessoas as (
  select c.id,
         btrim(coalesce(nullif(btrim(c.name), ''), nullif(btrim(c.display_name), ''), '')) as nome,
         e.telefone,
         case
           when coalesce(lower(c.document_type), 'cpf') <> 'cnpj'
                and regexp_replace(coalesce(c.document, ''), '\D', '', 'g') ~ '^[0-9]{11}$'
             then regexp_replace(c.document, '\D', '', 'g')
           else ''
         end as cpf,
         coalesce(nullif(btrim(lower(c.email)), ''), '') as email,
         c.birth_date,
         c.opt_out_marketing,
         c.updated_at
    from customers c
    join org o on o.id = c.organization_id
    join escolhido e on e.id = c.id
   where c.deleted_at is null
     and (:'sem_optout' <> 'sim' or c.opt_out_marketing = false)
)
-- mesmo telefone = mesma pessoa: fica o registro mais completo e, no empate, o
-- mais recente. Duplicata custa mais caro no destino que aqui.
select *,
       row_number() over (
         partition by telefone
         order by (case when cpf <> '' then 1 else 0 end
                 + case when email <> '' then 1 else 0 end
                 + case when birth_date is not null then 1 else 0 end
                 + case when nome <> '' then 1 else 0 end) desc,
                  updated_at desc, id
       ) as pos
  from pessoas;

-- Campo que falta sai VAZIO, não como par de aspas. O `coalesce(...,'')` lá
-- em cima existe pra ranquear o registro mais completo; aqui ele volta a NULL,
-- porque `""` no CSV é um texto vazio e importador nenhum gosta: dá pra gravar
-- um e-mail "" em cima de um e-mail que já existia no destino.
create temporary view v_export as
select nome,
       telefone,
       nullif(cpf, '')   as cpf,
       nullif(email, '') as email,
       case when birth_date is null then null
            when :'data_br' = 'sim' then to_char(birth_date, 'DD/MM/YYYY')
            else to_char(birth_date, 'YYYY-MM-DD') end as nascimento
  from v_pessoas where pos = 1
 order by nome, telefone;

-- daqui pra frente nada escreve
set default_transaction_read_only = on;
