-- ==============================================================================
-- 131_ponto_cert.sql  (idempotente)  —  PONTO: certificado A1 (ICP-Brasil) p/ assinar
-- AFD/AEJ em arquivo .p7s (PKCS#7/CMS destacado).
--
-- O .pfx (PKCS#12) é guardado no bucket PRIVADO (a1_cert_key). A senha é cifrada
-- (AES-256-GCM, chave derivada do COOKIE_SECRET) em a1_pass_enc. Guardamos também
-- titular (CN) e validade pra exibir no painel.
-- ==============================================================================

ALTER TABLE ponto_config
  ADD COLUMN IF NOT EXISTS a1_cert_key  text,   -- key do .pfx no bucket privado
  ADD COLUMN IF NOT EXISTS a1_pass_enc  text,   -- senha do .pfx cifrada (iv:tag:ciphertext em base64)
  ADD COLUMN IF NOT EXISTS a1_subject   text,   -- titular do certificado (CN)
  ADD COLUMN IF NOT EXISTS a1_not_after timestamptz; -- validade
