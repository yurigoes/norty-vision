import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { RateLimitService } from "./rate-limit.service";

@Global()
@Module({
  providers: [RedisService, RateLimitService],
  exports: [RedisService, RateLimitService],
})
export class RedisModule {}
