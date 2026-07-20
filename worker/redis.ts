import IORedis from "ioredis";
import { env } from "../server/env";

export function createWorkerRedisConnection() {
  return new IORedis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}
