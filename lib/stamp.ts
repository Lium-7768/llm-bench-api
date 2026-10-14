import { createHmac, timingSafeEqual } from "node:crypto";
import type { Target } from "./types";

/**
 * 无状态凭证：服务端不存任何东西，用 HMAC 签名证明「这一步确实在本服务上跑完了」。
 * 用来挡住编程彩蛋：五步的凭证换解锁令牌，解锁令牌才能进段位赛，上一档的凭证才能进下一档。
 * 没配置 LLMBENCH_SECRET 时整个彩蛋关闭。
 */

export type StampKind = "stage" | "unlock" | "tier";

interface StampBase {
  k: StampKind;
  /** 被测接口的指纹，见 targetKey */
  t: string;
  /** 过期时间，秒 */
  e: number;
}

function secret(): string | undefined {
  const s = process.env.LLMBENCH_SECRET?.trim();
  return s && s.length >= 16 ? s : undefined;
}

export function stampsEnabled(): boolean {
  return !!secret();
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

/**
 * 被测接口的指纹：协议、地址、模型、密钥一起做 HMAC。
 * 凭证因此只对同一个接口和模型有效；密钥只参与计算，凭证里看不出来，也不落盘。
 */
export function targetKey(t: Target): string {
  return createHmac("sha256", secret() ?? "")
    .update(["target", t.protocol, t.baseUrl.trim().replace(/\/+$/, ""), t.model, t.apiKey].join("\n"))
    .digest("base64url")
    .slice(0, 22);
}

function mac(body: string): string {
  return createHmac("sha256", secret() ?? "")
    .update(body)
    .digest("base64url");
}

/** 签发凭证；彩蛋关闭时返回 undefined */
export function sign<T extends object>(
  kind: StampKind,
  target: Target,
  ttlSeconds: number,
  data: T,
): string | undefined {
  if (!stampsEnabled()) return undefined;
  const body = b64(
    JSON.stringify({ ...data, k: kind, t: targetKey(target), e: Math.floor(Date.now() / 1000) + ttlSeconds }),
  );
  return `${body}.${mac(body)}`;
}

/** 校验签名、类型、接口和有效期；不通过返回 null */
export function verify<T extends object>(token: unknown, kind: StampKind, target: Target): (T & StampBase) | null {
  if (!stampsEnabled() || typeof token !== "string" || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & StampBase;
    if (payload.k !== kind || payload.t !== targetKey(target)) return null;
    if (payload.e < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
