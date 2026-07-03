# ADR 0001 — Modelo de Multi-Tenancy

**Status**: Aceito · **Data**: 2026-05-18 · **Autor**: bootstrap

## Contexto

O yugo-platform precisa atender múltiplos clientes (organizações) que por
sua vez podem ter várias lojas/filiais. Os tipos de cliente atuais:

- Ótica com 3 unidades (Yugovitta atual): 1 organização, 3 lojas.
- Operador comercial com várias franquias.
- Cliente individual: 1 organização, 1 loja.

A reescrita deve permitir que **um usuário tenha papéis diferentes em
diferentes lojas** dentro da mesma organização (ex: "admin geral" na rede
mas só "recepcionista" numa unidade específica).

## Decisão

### Hierarquia

```
Plataforma (yugo, super-admin)
└── Organization (cliente master, ex: "Rede Ótica X")
    └── Store (filial/loja física)
        └── Memberships (User × Store × Role)
            └── User (humano com credencial)
```

### Tabelas centrais

- `organizations` — cliente que paga a assinatura. Tem `slug` único global.
- `stores` — filial. FK obrigatória pra `organization_id`. `slug` único dentro da org.
- `users` — credencial humana. Globalmente único por email.
- `memberships` — relação N:M `user × store × role`. Sem ON DELETE CASCADE
  no user pra preservar audit; soft-delete via `revoked_at`.
- `roles` — papéis (`owner`, `admin`, `manager`, `recepcao`, `medico`, `vendedor`, `readonly`).
  Permissões em `permissions jsonb`. Pré-populados via seed mas
  customizáveis por organização (versões com `organization_id`).

### Modelo de tenancy: **shared schema, isolated rows**

Todas as tabelas de negócio têm **`organization_id` e `store_id`** como
colunas explícitas, NOT NULL, com FK. Isolamento garantido por **RLS**
no Postgres (ver [ADR 0002](./0002-rls-strategy.md)).

Considerei e descartei:

- **Schema por tenant**: backup, migrations e queries cross-tenant ficam
  caóticos. Inviável com 100+ orgs.
- **Database por tenant**: idem, ainda pior em ops.
- **Apenas RLS sem store_id explícito**: torna queries lentas em prod
  porque o planner não usa o filtro tão bem; melhor explicito.

### Isolamento entre lojas dentro da mesma org

Mesmo dentro da mesma organização, os dados de **clientes, agendamentos,
leads** são **isolados por loja**. Um vendedor da loja A não vê leads
da loja B, a menos que o role permita.

**Exceção:** o role `owner`/`admin` da organização vê todas as lojas.
RLS permite isso via `app.current_role` (ver ADR 0002).

### Bypass para a plataforma

O super-admin do yugo precisa acessar tudo para suporte. Usa um role
especial `platform_admin` armazenado em uma tabela `platform_users`
separada das `users` normais. Sessões de platform_admin entram com
`SET LOCAL row_security = off` (apenas conexões autenticadas dessa
forma podem). Toda ação fica em `audit_log` com flag `as_platform_admin`.

## Consequências

**Positivas:**
- Modelo flexível: 1-1 (cliente pequeno) até 1-N (rede grande).
- Multinível natural: roles diferentes por loja.
- Backup/restore unificado.
- Migration única para todos os tenants.

**Negativas:**
- Todas as queries da API precisam setar `app.org_id` e `app.store_id`
  antes de executar (esquecer = vazamento).
- RLS adiciona overhead (~5-10%) — aceitável.
- Tabelas crescem rápido; vamos precisar particionar `audit_log`,
  `message_log` e `appointment_events` por mês quando passar de ~10M rows.

**Mitigação para "esquecer de setar":** middleware da API faz isso em
toda request autenticada. Testes de RLS rodam em CI com role de teste
sem permissão para confirmar que policies bloqueiam o que devem bloquear.
