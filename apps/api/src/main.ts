import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import pino from "pino";

import { AppModule } from "./app.module";
import { loadEnv } from "./config";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

// JSON nao sabe serializar BigInt nativamente — Prisma usa BigInt em colunas
// como limit_cents, amount_cents, income_cents, etc. Sem isto, qualquer
// endpoint que retorne esses campos lanca "Do not know how to serialize a
// BigInt" e devolve 500. Serializamos como string (o front ja faz Number()).
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const env = loadEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers["cookie"]',
        'req.headers["authorization"]',
        "req.body.password",
        "req.body.access_password",
        '*.password',
        '*.password_hash',
      ],
      remove: true,
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true, // estamos atras do Caddy
      logger: false,    // pino direto
      bodyLimit: 1024 * 1024 * 16, // 16 MB (uploads via dataURL JSON: fundo do ponto, comprovantes, A1, DANFE)
    }),
    {
      bufferLogs: true,
      // guarda o corpo cru (req.rawBody) — necessário pra validar a assinatura
      // X-Hub-Signature-256 do webhook do WhatsApp Cloud API (Meta).
      rawBody: true,
    },
  );

  // confia em proxy (Caddy) pra ler X-Forwarded-* corretamente
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // headers de seguranca aplicados pelo Caddy na borda (HSTS, CSP, X-Frame, etc).
  // Nao usamos @fastify/helmet aqui pra evitar conflito de versao com NestJS 10.

  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    },
  });

  // upload de arquivos (logos, og:image, etc) - limita 10 MB por arquivo
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // todas as rotas ficam atras de /api (Caddy faz /api/* -> api:3001).
  // Health-check do Caddy interno bate em http://api:3001/api/health.
  app.setGlobalPrefix("api");

  await app.listen(env.API_PORT, "0.0.0.0");
  logger.info({ port: env.API_PORT }, "yugo-api started");
}

bootstrap().catch((err) => {
  console.error("bootstrap failed", err);
  process.exit(1);
});
