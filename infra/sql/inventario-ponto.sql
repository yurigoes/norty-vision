\set ON_ERROR_STOP on
set default_transaction_read_only = on;
set timezone = 'America/Sao_Paulo';
\pset footer off
\pset null ''

\echo '--- empresas neste banco ---'
select slug, name, status from organizations order by slug;

\echo
\echo '--- funcionarios do ponto (a chave do casamento e o CPF) ---'
select pe.name, coalesce(pe.cpf,'(sem cpf)') as cpf, pe.active,
       coalesce(pe.matricula,'') as matricula,
       pe.id as ponto_employee_id, coalesce(pe.employer_id::text,'(sem empregador)') as employer_id
  from ponto_employee pe
  join organizations o on o.id = pe.organization_id
 where o.slug = :'empresa'
 order by pe.active desc, pe.name;

\echo
\echo '--- o que existe pra transferir (linhas por tabela) ---'
select t as tabela,
       (xpath('/row/c/text()', query_to_xml(
          format('select count(*) as c from public.%I where organization_id = (select id from organizations where slug = %L)', t, :'empresa'),
          false, true, '')))[1]::text::bigint as linhas
  from unnest(array[
    'ponto_punch','ponto_employee','ponto_employer','ponto_device','ponto_config',
    'ponto_schedule','schedule_templates','schedule_slots','work_shifts',
    'ponto_schedule_override','ponto_holiday',
    'ponto_closing','ponto_bank_movement','ponto_bank_request',
    'ponto_justification','ponto_espelho_signature',
    'ponto_leave','ponto_vacation','ponto_allocation','ponto_shift_swap',
    'ponto_extra_shift','ponto_extra_punch','ponto_store_transfer','ponto_assiduidade',
    'ponto_schedule_plan','ponto_schedule_import','ponto_schedule_settings'
  ]) t
 where exists (select 1 from information_schema.columns
                where table_schema='public' and table_name=t and column_name='organization_id')
 order by 2 desc nulls last, 1;

\echo
\echo '--- batidas por mes (e o intervalo) ---'
select to_char(p.punched_at, 'YYYY-MM') as mes, count(*) as batidas,
       count(*) filter (where p.voided) as anuladas,
       min(p.punched_at)::date as primeira, max(p.punched_at)::date as ultima,
       min(p.nsr) as nsr_min, max(p.nsr) as nsr_max
  from ponto_punch p
  join organizations o on o.id = p.organization_id
 where o.slug = :'empresa'
 group by 1 order by 1;

\echo
\echo '--- a cadeia de hash fecha? (por empregador) ---'
select coalesce(p.employer_id::text,'(sem empregador)') as empregador,
       count(*) as batidas, min(p.nsr) as nsr_min, max(p.nsr) as nsr_max,
       count(*) filter (where p.prev_hash is null) as sem_prev_hash
  from ponto_punch p
  join organizations o on o.id = p.organization_id
 where o.slug = :'empresa'
 group by 1;
