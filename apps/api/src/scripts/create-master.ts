/**
 * create-master.ts
 *
 * Cria o primeiro master (platform_user) com Argon2id.
 * Roda dentro do container `yugo-api` que tem DATABASE_URL setado:
 *
 *   docker exec -e MASTER_EMAIL=... -e MASTER_NAME=... -e MASTER_PASSWORD=... \
 *     yugo-api node dist/scripts/create-master.js
 *
 * Ou use o script wrapper em infra/scripts/create-master.sh.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

async function main() {
  const email = process.env.MASTER_EMAIL?.trim().toLowerCase();
  const name = process.env.MASTER_NAME?.trim();
  const password = process.env.MASTER_PASSWORD;

  if (!email || !name || !password) {
    console.error("ERRO: defina MASTER_EMAIL, MASTER_NAME, MASTER_PASSWORD");
    process.exit(2);
  }
  if (password.length < 12) {
    console.error("ERRO: senha precisa de no minimo 12 caracteres");
    process.exit(3);
  }

  const prisma = new PrismaClient();
  try {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // RLS exige is_platform_admin pra mexer em platform_users.
    // SET LOCAL via set_config(true) dura a transacao.
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.is_platform_admin','true', true)`,
      );
      const existing = await tx.platformUser.findUnique({ where: { email } });
      if (existing) {
        console.log(`Master ja existe (id=${existing.id}). Atualizando senha...`);
      }
      return tx.platformUser.upsert({
        where: { email },
        create: { email, name, passwordHash: hash, mfaEnabled: false, status: "active" },
        update: { name, passwordHash: hash, status: "active" },
      });
    });

    console.log("--- Master criado/atualizado ---");
    console.log("id:    ", user.id);
    console.log("email: ", user.email);
    console.log("name:  ", user.name);
    console.log("status:", user.status);
    console.log("mfa:   ", user.mfaEnabled ? "ON" : "off (ative apos primeiro login!)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
