"use client";

import { Egg } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Report } from "@/lib/types";
import { useConfig } from "@/lib/web/config";
import { saveEgg } from "@/lib/web/egg";
import { IconButton } from "./ui";

const hostOf = (url: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
};

/**
 * 编程彩蛋的入口。只有报告里存着服务端签发的解锁凭证（五步跑完、糖果全对时才会签发）、凭证没过期、
 * 并且当前配置的还是这份报告测的那个接口和模型时才显示：凭证只对当时的接口、模型和密钥有效。
 */
export function EggEntry({ report }: { report: Report }) {
  const { config } = useConfig();
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const unlock = report.unlock;
  if (!unlock || Date.parse(unlock.expiresAt) <= now) return null;
  if (config.model !== report.model || hostOf(config.baseUrl) !== report.host) return null;

  return (
    <span className="relative isolate inline-grid">
      <span
        aria-hidden
        className="absolute -inset-1.5 -z-10 rounded-2xl spectrum-bg opacity-90 blur-sm motion-safe:animate-pulse"
      />
      <IconButton
        label="你发现了一个彩蛋"
        icon={<Egg size={18} />}
        onClick={() => {
          saveEgg({ ...unlock, reportId: report.id, model: report.model });
          router.push("/arena");
        }}
      />
    </span>
  );
}
