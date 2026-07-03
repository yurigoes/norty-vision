-- ==============================================================================
-- 099_org_ai_providers.sql  (idempotente)
--
-- Conexões de IA por empresa (assistente do call center). Cada empresa cadastra
-- suas próprias chaves. Múltiplas conexões com prioridade → failover: quando
-- uma estoura a cota do dia, entra em "descanso" (cooldown_until) e o sistema
-- pula pra próxima continuando o mesmo contexto.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS org_ai_providers (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('anthropic','groq','gemini','cloudflare','openai')),
  label            text,
  api_key          text,
  model            text,
  base_url         text,          -- p/ openai-compatível (OpenRouter etc.)
  account_id       text,          -- p/ cloudflare workers ai
  priority         int NOT NULL DEFAULT 0,   -- menor = tentado primeiro
  is_active        boolean NOT NULL DEFAULT true,
  cooldown_until   timestamptz,   -- "descanso" após estourar cota
  last_error       text,
  last_used_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_ai_providers_org_idx ON org_ai_providers (organization_id, is_active, priority);
DROP TRIGGER IF EXISTS tg_org_ai_providers_updated_at ON org_ai_providers;
CREATE TRIGGER tg_org_ai_providers_updated_at BEFORE UPDATE ON org_ai_providers
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE org_ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_ai_providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_ai_providers_rls ON org_ai_providers;
CREATE POLICY org_ai_providers_rls ON org_ai_providers FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
