"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * 浮层挂载点：在弹窗里就挂到该 <dialog>（原生弹窗位于顶层，挂到 body 会被盖住），否则挂到 body。
 * 浮层用 fixed 定位，不参与任何容器的布局，因此不会撑出滚动条，也不会被 overflow 裁掉。
 */
function layerRoot(anchor: HTMLElement | null): HTMLElement {
  return (anchor?.closest("dialog") as HTMLElement | null) ?? document.body;
}

/** 贴着锚点显示的浮层，自动限制在视口内，下方放不下时翻到上方 */
export function AnchoredLayer({
  anchor,
  open,
  children,
  matchWidth,
  gap = 8,
  className,
  layerRef,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  /** 与锚点同宽（下拉框用） */
  matchWidth?: boolean;
  gap?: number;
  className?: string;
  layerRef?: RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = layerRef ?? own;
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = matchWidth ? a.width : el.offsetWidth;
      const h = el.offsetHeight;
      const margin = 8;
      let left = matchWidth ? a.left : a.left + a.width / 2 - w / 2;
      left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
      const below = a.bottom + gap;
      const top = below + h > window.innerHeight - margin && a.top - gap - h > margin ? a.top - gap - h : below;
      setStyle({
        position: "fixed",
        top,
        left,
        width: matchWidth ? a.width : undefined,
        zIndex: 100,
        visibility: "visible",
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, ref, matchWidth, gap]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} style={style} className={className}>
      {children}
    </div>,
    layerRoot(anchor.current),
  );
}

/** 悬停或聚焦时显示的文字提示 */
export function Tooltip({
  anchor,
  open,
  label,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  label: string;
}) {
  return (
    <AnchoredLayer
      anchor={anchor}
      open={open}
      className="pointer-events-none rounded-md bg-ink px-2 py-1 text-xs whitespace-nowrap text-white shadow-lg"
    >
      {label}
    </AnchoredLayer>
  );
}
