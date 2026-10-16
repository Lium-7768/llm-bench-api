"use client";

import { Check, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Stage } from "@/lib/types";
import { useCountUp } from "./Score";
import { STAGE_INFO } from "./StageIcon";
import { cx } from "./ui";

export type StageStatus = "off" | "pending" | "active" | "done" | "error";

export interface PipelineStage {
  id: Stage;
  status: StageStatus;
  /** 0-1，当前步骤内的进度 */
  progress: number;
  /** 完成后的得分；鹈鹕为 null */
  score?: number | null;
  /** 节点下方的状态说明 */
  caption: string;
}

/**
 * 横向光束管道：四个节点代表四个步骤。
 * 光束沿连线流向当前节点，当前节点脉冲发光并显示步内进度环，完成的节点点亮并显示得分。
 */
export function Pipeline({
  stages,
  idle,
  onToggle,
}: {
  stages: PipelineStage[];
  /** 待机：光束循环流动，节点可点选 */
  idle?: boolean;
  onToggle?: (stage: Stage) => void;
}) {
  return (
    <div className="flex items-start">
      {stages.map((s, i) => (
        <div key={s.id} className={cx("flex items-start", i < stages.length - 1 && "flex-1")}>
          <Node stage={s} idle={idle} onToggle={onToggle} />
          {i < stages.length - 1 && <Connector from={s} to={stages[i + 1]} idle={idle} index={i} />}
        </div>
      ))}
    </div>
  );
}

function Node({ stage, idle, onToggle }: { stage: PipelineStage; idle?: boolean; onToggle?: (s: Stage) => void }) {
  const info = STAGE_INFO[stage.id];
  const { status } = stage;
  const r = 34;
  const c = 2 * Math.PI * r;

  const body = (
    <div className="relative grid size-14 place-items-center sm:size-20">
      {/* 当前步骤：向外扩散的光晕 */}
      {status === "active" && (
        <>
          {[0, 1].map((k) => (
            <motion.span
              key={k}
              className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, ${info.hex}40, transparent 70%)` }}
              initial={{ scale: 0.8, opacity: 0.9 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 2, repeat: Infinity, delay: k, ease: "easeOut" }}
            />
          ))}
        </>
      )}

      {/* 进度环 */}
      <svg viewBox="0 0 80 80" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-tint-2)" strokeWidth="3" />
        <motion.circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={info.hex}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{
            strokeDashoffset:
              c * (1 - (status === "done" ? 1 : status === "active" ? Math.max(stage.progress, 0.04) : 0)),
          }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>

      {/* 当前步骤：绕圈的流光 */}
      {status === "active" && (
        <motion.span
          className="absolute inset-[3px] rounded-full"
          style={{
            background: `conic-gradient(from 0deg, transparent 0 70%, ${info.hex} 100%)`,
            mask: "radial-gradient(circle, transparent 62%, #000 64%)",
            WebkitMask: "radial-gradient(circle, transparent 62%, #000 64%)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
        />
      )}

      <motion.span
        className={cx(
          "relative grid size-10 place-items-center rounded-full transition-colors duration-500 sm:size-14",
          status === "done"
            ? "text-white"
            : status === "error"
              ? "bg-rose/10 text-rose"
              : status === "active"
                ? "bg-surface"
                : "bg-surface",
          status === "off" && "opacity-40 grayscale",
        )}
        style={
          status === "done"
            ? { background: `linear-gradient(135deg, ${info.hex}, #2563eb)`, boxShadow: `0 8px 24px -8px ${info.hex}` }
            : { boxShadow: "0 2px 10px -4px rgb(0 0 0 / .15)" }
        }
        animate={status === "active" ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={
          status === "active" ? { duration: 1.6, repeat: Infinity } : { type: "spring", stiffness: 300, damping: 14 }
        }
      >
        <info.Icon
          size={22}
          className={status === "done" ? "text-white" : status === "error" ? "text-rose" : info.color}
        />
        <AnimatePresence>
          {(status === "done" || status === "error") && (
            <motion.span
              className={cx(
                "absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full ring-2 ring-surface",
                status === "done" ? "bg-mint text-white" : "bg-rose text-white",
              )}
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
            >
              {status === "done" ? <Check size={12} strokeWidth={3.5} /> : <X size={12} strokeWidth={3.5} />}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </div>
  );

  return (
    <div className="flex w-16 shrink-0 flex-col items-center text-center sm:w-28">
      {idle && onToggle ? (
        <button
          type="button"
          aria-pressed={status !== "off"}
          aria-label={`${info.name}${status === "off" ? "（未选，点击加入）" : "（已选，点击移除）"}`}
          title={status === "off" ? "点击加入这一步" : "点击跳过这一步"}
          onClick={() => onToggle(stage.id)}
          className="rounded-full transition hover:scale-105 active:scale-95"
        >
          {body}
        </button>
      ) : (
        body
      )}
      <p
        className={cx(
          "mt-2 text-sm font-medium transition-colors",
          status === "active" ? "text-ink" : status === "off" ? "text-faint" : "text-readout",
        )}
      >
        {info.name}
      </p>
      <Caption stage={stage} />
    </div>
  );
}

function Caption({ stage }: { stage: PipelineStage }) {
  const score = useCountUp(stage.status === "done" && typeof stage.score === "number" ? stage.score : null, 1200);
  return (
    <AnimatePresence mode="wait">
      <motion.p
        key={stage.status === "done" && score !== null ? "score" : stage.caption}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.25 }}
        className={cx(
          "mt-0.5 text-xs tabular-nums",
          stage.status === "active" ? "text-blue" : stage.status === "error" ? "text-rose" : "text-faint",
        )}
      >
        {stage.status === "done" && score !== null ? (
          <span className="font-display text-base font-bold spectrum-text">{Math.round(score)}</span>
        ) : (
          stage.caption
        )}
      </motion.p>
    </AnimatePresence>
  );
}

/** 两个节点之间的连线：已走过的部分是实心渐变，正在流向的部分有光束 */
function Connector({
  from,
  to,
  idle,
  index,
}: {
  from: PipelineStage;
  to: PipelineStage;
  idle?: boolean;
  index: number;
}) {
  const passed = from.status === "done" || from.status === "error";
  const flowing = idle || (passed && to.status === "active");
  const fromHex = STAGE_INFO[from.id].hex;
  const toHex = STAGE_INFO[to.id].hex;

  return (
    <div className="relative mt-7 h-[3px] min-w-3 flex-1 overflow-hidden rounded-full bg-tint-2 sm:mt-10">
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: `linear-gradient(90deg, ${fromHex}, ${toHex})` }}
        initial={false}
        animate={{ width: passed && !idle ? "100%" : "0%" }}
        transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
      />
      {flowing && (
        <motion.div
          className="absolute inset-y-0 w-2/5 rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${toHex}, white, transparent)`,
            filter: "blur(0.5px)",
          }}
          initial={{ x: "-120%" }}
          animate={{ x: "320%" }}
          transition={{
            duration: idle ? 2.4 : 1.3,
            repeat: Infinity,
            ease: "easeInOut",
            delay: idle ? index * 0.6 : 0,
          }}
        />
      )}
    </div>
  );
}
