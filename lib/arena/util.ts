/** 出题用的小工具：确定性随机数和读输入 */

/** mulberry32：同一种子得到同一串随机数 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
export const nums = (input: string) => input.split(/\s+/).filter(Boolean).map(Number);
export const lines = (input: string) => input.replace(/\r/g, "").split("\n");

/** 从 alphabet 里随机取 n 个字符拼成字符串 */
export const randomText = (rand: () => number, n: number, alphabet = "abcdefghijklmnopqrstuvwxyz") =>
  Array.from({ length: n }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
