import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { Public } from "../auth/decorators";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  health() {
    return { status: "ok", ts: new Date().toISOString() };
  }

  @Public()
  @Get("deep")
  async deep() {
    const [db, cache] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);

    return {
      status:
        db.status === "fulfilled" && cache.status === "fulfilled"
          ? "ok"
          : "degraded",
      checks: {
        postgres: db.status === "fulfilled" ? "ok" : "down",
        redis: cache.status === "fulfilled" ? "ok" : "down",
      },
      ts: new Date().toISOString(),
    };
  }
}
