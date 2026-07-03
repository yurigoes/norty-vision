# ADR 0003 — Chaves primárias UUID (com path pra UUIDv7)

**Status**: Aceito · **Data**: 2026-05-18

## Contexto

Toda tabela precisa de PK. Opções:

- `bigserial` (int64 auto-incremento): rápido, ordenável, mas **enumera-
  ção trivial** (`/api/appointments/123` → próximo é 124). Em API multi-
  tenant pública isso é problema.
- `uuid v4`: aleatório, não enumerável, mas **fragmenta índices** (insert
  fora de ordem; B-tree dá split frequentes).
- `uuid v7` (RFC 9562): aleatório + prefixo de timestamp. Ordenável,
  não enumerável, performance de inserção similar a bigserial.
- `ULID`: similar ao v7 mas binário diferente.

## Decisão

Adotar **UUID** como PK em todas as tabelas de negócio.

Imediatamente: `gen_random_uuid()` (UUIDv4) — disponível em qualquer
Postgres 13+ via `pgcrypto`, zero dependência externa.

Quando passar de ~1M rows por tabela: migrar para UUIDv7 via extensão
`pg_uuidv7` (single binary, MIT). Migração é compatível — o tipo é o
mesmo, só a função geradora muda. PKs existentes ficam, novas vêm v7.

Helper SQL central pra trocar fácil:

```sql
CREATE OR REPLACE FUNCTION app.new_id() RETURNS uuid LANGUAGE sql AS $$
  SELECT gen_random_uuid();
$$;
```

Toda tabela usa `id uuid PRIMARY KEY DEFAULT app.new_id()`. Migração
no futuro: substituir o corpo da função.

### Exceções

- `audit_log`: usa `bigserial` interno (rapidez de append; nunca é
  retornado via API; combinado com PK composta de `(created_at, id)`).
- Tabelas de log/eventos high-write: idem.
- `sessions`: usa token aleatório base64url (256 bits) gerado pela app,
  não UUID.

## Consequências

**Positivas:**
- URLs/APIs não vazam contagem de tenants/recursos.
- Pode gerar IDs no client antes de enviar (offline-first, optimistic UI).
- Conflitos de merge em migrations zerados.

**Negativas:**
- 16 bytes vs 8 bytes (bigserial) → +30% no tamanho do índice. Aceitável.
- Logs ficam mais verbosos. Usamos `id::text` truncado nos primeiros 8
  chars em logs informativos.
- Em joins explicar plan fica mais difícil de ler.

## Padrão de IDs externos

Pra URLs públicas curtas em emails/SMS (ex: link de confirmação de
agendamento), usar **`short_code`** separado:

- 8 chars Base32 (Crockford), case-insensitive
- Unico por tabela (ex: appointment_short_codes)
- Indexado mas NÃO é PK
- Gerado por trigger ou pela app

`POST /confirm/AB12CDEF` → mais amigável que UUID.
