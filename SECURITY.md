# Política de Segurança — yugo-platform

## Reportar vulnerabilidade

Envie um e-mail privado para `security@yugochat.com.br` com:
- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto estimado
- Sua chave PGP se quiser resposta criptografada

**Não** abra issue pública. Damos retorno em até 72h.

## Modelo de ameaças (alto nível)

| Ator                       | Capacidade                                   | Mitigação                                   |
| -------------------------- | -------------------------------------------- | ------------------------------------------- |
| Usuário curioso            | Lê HTML, inspeciona DevTools                 | Sem secrets no front, JWT httpOnly          |
| Tenant malicioso           | Tenta acessar dados de outro tenant          | RLS no Postgres como última linha          |
| Atacante externo           | Brute-force, scraping, DDoS leve             | Rate-limit Redis, fail2ban, Caddy WAF       |
| Funcionário ex-empregado   | Tinha acesso a secrets                       | Rotação obrigatória, audit log, sops+age    |
| Comprometimento de VPS     | Acesso ao filesystem                         | Secrets criptografados em repouso, backups |

## Inventário criptográfico

| Uso                        | Algoritmo            | Tamanho | Rotação           |
| -------------------------- | -------------------- | ------- | ----------------- |
| Senhas de usuário          | Argon2id             | n/a     | rehash em login   |
| Sessões (cookie)           | random bytes         | 256 bit | 30 dias / logout  |
| JWT service-to-service     | EdDSA (Ed25519)      | n/a     | trimestral        |
| TLS                        | TLS 1.3              | n/a     | Let's Encrypt 60d |
| SSH                        | Ed25519              | n/a     | anual             |
| Dados em repouso (PII)     | AES-256-GCM          | 256 bit | sob demanda       |
| Secrets de deploy          | age                  | X25519  | sob demanda       |
| Hash de auditoria          | SHA-256              | 256 bit | n/a               |

## Checklist OWASP Top 10 (status)

- [ ] A01 Broken Access Control — RLS + RBAC unitário
- [ ] A02 Cryptographic Failures — Argon2id, TLS 1.3, AES-GCM em repouso
- [ ] A03 Injection — Prisma parametrizado, Zod em todos os boundaries
- [ ] A04 Insecure Design — modelo de ameaças (este doc), ADRs versionadas
- [ ] A05 Security Misconfiguration — Helmet, CSP, HSTS, headers default
- [ ] A06 Vulnerable Components — Dependabot + Trivy no CI
- [ ] A07 Auth Failures — Better-Auth, MFA TOTP, lockout, rate-limit
- [ ] A08 Software/Data Integrity — assinatura de imagens Docker, lockfile
- [ ] A09 Logging & Monitoring — Pino + Sentry, audit log append-only
- [ ] A10 SSRF — allowlist de URLs externas no worker

Itens vão sendo marcados conforme implementação avança.

## Práticas obrigatórias do time

1. **Nunca** commitar `.env`, chaves privadas, certificados, dumps de banco.
2. Pre-commit hook bloqueia padrões comuns (gitleaks).
3. PRs com mudança em `auth/`, `db/policies/`, `api/middleware/` exigem 1 review.
4. Rotação de secrets em todo offboarding.
5. Backups testados (restore real) trimestralmente.
