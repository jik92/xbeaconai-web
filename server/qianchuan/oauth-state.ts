import { createHash, randomBytes } from "node:crypto";
import { qianchuanStore } from "./store";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function createQianchuanOauthState(ownerUserId: string) {
  const state = randomBytes(32).toString("base64url");
  qianchuanStore.createOauthState(ownerUserId, hash(state), new Date(Date.now() + 10 * 60 * 1000).toISOString());
  return state;
}

export function consumeQianchuanOauthState(state: string) {
  return qianchuanStore.consumeOauthState(hash(state));
}
