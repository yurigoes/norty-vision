import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("production"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  TZ: z.string().default("America/Sao_Paulo"),

  // banco
  DATABASE_URL: z.string().url(),

  // redis (cache + sessoes)
  REDIS_URL: z.string().url(),

  // auth (user normal)
  SESSION_COOKIE_NAME: z.string().default("nv_session"),
  // vazio/undefined => cookie HOST-ONLY (sem atributo Domain). É o correto pro
  // esquema multi-tenant por subdomínio: cada host (apex master + <slug>.norty.com.br)
  // gerencia sua própria sessão, sem depender de wildcard de domínio de cookie.
  SESSION_COOKIE_DOMAIN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().optional(),
  ),

  // Norty Vision — identidade + API de licenciamento (/api/norty/v1)
  NORTY_SYSTEM_NAME: z.string().default("Norty Vision"),
  NORTY_LICENSE_TOKEN: z.string().optional(),
  // slug da empresa "dona do SaaS" (yugo). No domínio raiz (apex), os logins
  // por CPF/documento (funcionário/fornecedor) escopam pra ESTA empresa — assim
  // o apex nunca puxa gente de empresa cliente (ex.: Zito).
  PLATFORM_ORG_SLUG: z.string().default("yugo"),
  SESSION_DURATION_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECRET: z.string().min(32),

  // auth (master/platform)
  MASTER_COOKIE_NAME: z.string().default("yugo_master"),
  MASTER_SESSION_DURATION_HOURS: z.coerce.number().int().positive().default(12),

  // auth (cliente final / portal crediario)
  CUSTOMER_COOKIE_NAME: z.string().default("yugo_customer"),
  CUSTOMER_SESSION_DURATION_DAYS: z.coerce.number().int().positive().default(7),

  // auth (portal do fornecedor /f)
  SUPPLIER_COOKIE_NAME: z.string().default("yugo_supplier"),

  // auth (portal do funcionário /rh)
  EMPLOYEE_COOKIE_NAME: z.string().default("yugo_employee"),
  EMPLOYEE_SESSION_DURATION_DAYS: z.coerce.number().int().positive().default(7),

  // base INTERNA pra webhooks da Evolution (mesma rede docker) — evita sair
  // pela internet/Cloudflare (que dava 502). Ex.: http://api:3001
  EVOLUTION_WEBHOOK_BASE: z.string().default("http://api:3001"),

  // rate limit
  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().default(5),

  // CORS - origens permitidas (CSV)
  CORS_ORIGINS: z
    .string()
    .default("https://vision.norty.com.br")
    .transform((s) => s.split(",").map((x) => x.trim())),

  // log
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // SMTP (envio de emails - reset de senha, convites)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Norty Vision <no-reply@vision.norty.com.br>"),

  // App public URL pra montar links em emails
  APP_PUBLIC_URL: z.string().default("https://vision.norty.com.br"),

  // IA do bot de atendimento (opcional). Sem a chave, o bot usa menu + palavras-chave.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-haiku-latest"),

  // WhatsApp Cloud API (Meta) — canal oficial pra central de leads. Paralelo ao
  // Evolution: um número fica OU no Cloud API OU no Evolution, nunca nos dois.
  // META_STORE_ID = uuid da loja "dona" deste número (resolve a org no inbound).
  // Multi-tenant futuro: mapear phone_number_id -> store numa tabela.
  META_GRAPH_VERSION: z.string().default("v21.0"),
  META_WABA_ID: z.string().optional(),            // WhatsApp Business Account id (pra puxar templates)
  META_PHONE_NUMBER_ID: z.string().optional(),    // Phone Number id (pra enviar/receber)
  META_ACCESS_TOKEN: z.string().optional(),       // token PERMANENTE de System User
  META_VERIFY_TOKEN: z.string().optional(),        // token de verificação do webhook (você escolhe)
  META_APP_SECRET: z.string().optional(),          // App Secret (valida assinatura X-Hub-Signature-256)
  META_STORE_ID: z.string().optional(),            // uuid da loja dona do número
  META_AI_AUTOREPLY: z.coerce.boolean().default(false), // chave de segurança da IA (default OFF)

  // MinIO / S3
  MINIO_ENDPOINT: z.string().url().default("http://minio:9000"),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET_PRIVATE: z.string().default("yugo-platform"),
  MINIO_BUCKET_PUBLIC: z.string().default("yugo-public"),
  MINIO_PUBLIC_BASE_URL: z
    .string()
    .default("https://yugochat.com.br/storage"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}
