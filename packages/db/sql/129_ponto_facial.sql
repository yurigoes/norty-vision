-- ==============================================================================
-- 129_ponto_facial.sql  (idempotente)  —  PONTO Fase 3: facial + liveness + antifraude
--
-- Reconhecimento facial PLUGÁVEL (provider 'none' ou 'http' apontando p/ um serviço
-- self-hosted tipo CompreFace/DeepFace ou adaptador AWS). Enrollment do rosto por
-- funcionário; verificação na marcação; prova de vida (liveness) e flags antifraude
-- gravadas na marcação. Tudo configurável por empresa e por dispositivo.
-- ==============================================================================

-- Config facial no empregador
ALTER TABLE ponto_config
  ADD COLUMN IF NOT EXISTS face_provider     text NOT NULL DEFAULT 'none',  -- 'none' | 'http'
  ADD COLUMN IF NOT EXISTS face_provider_url text,                          -- endpoint do serviço de verificação
  ADD COLUMN IF NOT EXISTS face_provider_key text,                          -- chave/segredo (RLS protege; mover p/ vault depois)
  ADD COLUMN IF NOT EXISTS face_threshold    integer NOT NULL DEFAULT 75,   -- similaridade mínima (0-100)
  ADD COLUMN IF NOT EXISTS require_face      boolean NOT NULL DEFAULT false, -- exigir verificação facial
  ADD COLUMN IF NOT EXISTS require_liveness  boolean NOT NULL DEFAULT false, -- exigir prova de vida
  ADD COLUMN IF NOT EXISTS face_enforce      boolean NOT NULL DEFAULT false; -- true=bloqueia se não bater; false=só sinaliza p/ revisão

-- Rosto de referência do funcionário (bucket privado)
ALTER TABLE ponto_employee
  ADD COLUMN IF NOT EXISTS face_ref_key     text,
  ADD COLUMN IF NOT EXISTS face_enrolled_at timestamptz;

-- Resultado da verificação por marcação
ALTER TABLE ponto_punch
  ADD COLUMN IF NOT EXISTS face_score   double precision,   -- similaridade 0-100 (null = não verificado)
  ADD COLUMN IF NOT EXISTS face_match   boolean,
  ADD COLUMN IF NOT EXISTS liveness_ok  boolean,
  ADD COLUMN IF NOT EXISTS fraud_flags  jsonb;              -- ex.: ["gps_suspeito","liveness_baixa","rosto_divergente"]
