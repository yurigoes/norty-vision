-- ==============================================================================
-- 217: TRANSFERÊNCIA TEMPORÁRIA DE LOJA.
--
-- Funcionário emprestado pra outra loja da MESMA empresa por um período:
-- enquanto a transferência está ativa, ele bate o ponto NA LOJA DESTINO, e o
-- terminal da loja de origem recusa com uma mensagem que diz onde ele tem que
-- bater. Não é alocação/cessão (`ponto_allocation`), que é entre EMPRESAS e
-- muda quem assina a folha; aqui a empregadora é a mesma.
--
-- ESTA MIGRATION NÃO EXISTE NO NORTY RH.
-- Lá a tabela está no `schema.prisma` e é usada pelo código, mas nenhum arquivo
-- em `packages/db/sql` a cria — foi feita direto no banco de produção e nunca
-- versionada. (O mesmo caso do módulo `collab` e da tela `agenda/recepcao`, que
-- o ensaio do deploy apontou como "código que existe só aqui".) Então escrevi
-- a partir do modelo Prisma, e é por isso que a ordem das colunas e os nomes
-- batem com ele.
--
-- Aqui ela é versionada de verdade — e o `schema-sql.check.mts` desta base
-- recusaria o modelo sem migration, que é como esse tipo de buraco não se
-- repete.
-- ==============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS ponto_store_transfer (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ponto_employee_id  uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  -- de onde saiu (informativo; pode ser null se o funcionário não tinha loja)
  from_store_id      uuid REFERENCES stores(id) ON DELETE SET NULL,
  -- pra onde vai: é ONDE ELE BATE O PONTO enquanto a transferência vale
  to_store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  starts_at          date NOT NULL,
  ends_at            date NOT NULL,
  reason             text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS ponto_store_transfer_emp_idx ON ponto_store_transfer (organization_id, ponto_employee_id, status);

ALTER TABLE ponto_store_transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_store_transfer FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_store_transfer_rls ON ponto_store_transfer;
CREATE POLICY ponto_store_transfer_rls ON ponto_store_transfer FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ponto_store_transfer TO yugo_app;

COMMIT;
