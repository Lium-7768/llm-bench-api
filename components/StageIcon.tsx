import { Bird, BrainCircuit, Candy, Dna, Fingerprint } from "lucide-react";
import type { Stage } from "@/lib/types";

export const STAGE_INFO: Record<Stage, { name: string; desc: string; Icon: typeof Bird; color: string; hex: string }> =
  {
    detect: {
      name: "指纹检测",
      desc: "核对接口有没有换模型、吞系统指令、截断上下文、伪造流式",
      Icon: Fingerprint,
      color: "text-violet",
      hex: "#7c3aed",
    },
    basic: {
      name: "基础测试",
      desc: "推理、阅读、代码、知识、指令遵循，本地客观判分",
      Icon: BrainCircuit,
      color: "text-blue",
      hex: "#2563eb",
    },
    candy: {
      name: "糖果测试",
      desc: "改过条件的熟题和不存在的文献，看模型会不会顺着编",
      Icon: Candy,
      color: "text-cyan",
      hex: "#0891b2",
    },
    colorblind: {
      name: "综合推理",
      desc: "知识 + 多步反证 + 抗诱导的复合题，单独一步，不计入综合分",
      Icon: Dna,
      color: "text-amber",
      hex: "#d97706",
    },
    pelican: {
      name: "鹈鹕测试",
      desc: "让模型用 SVG 画一只骑自行车的鹈鹕，看图说话，不计分",
      Icon: Bird,
      color: "text-mint",
      hex: "#059669",
    },
  };

export function StageIcon({ stage, size = 18, className }: { stage: Stage; size?: number; className?: string }) {
  const { Icon, color } = STAGE_INFO[stage];
  return <Icon size={size} className={className ?? color} aria-hidden />;
}
