"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Tooltip } from "./Layer";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** 悬停或键盘聚焦时显示提示 */
function useTip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return [ref, open, { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide }] as const;
}

/**
 * 只有图标的按钮。label 同时用作无障碍名称和悬停提示。
 */
export function IconButton({
  label,
  icon,
  tone = "default",
  size = "md",
  className,
  onClick,
  ...rest
}: Omit<ComponentProps<"button">, "children"> & {
  label: string;
  icon: ReactNode;
  tone?: "default" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const [tipRef, tipOpen, tipHandlers] = useTip<HTMLButtonElement>();
  return (
    <>
      <button
        ref={tipRef}
        type="button"
        aria-label={label}
        className={cx(
          "inline-grid shrink-0 place-items-center rounded-xl border transition active:scale-95 disabled:pointer-events-none disabled:opacity-35",
          size === "sm" ? "size-8" : "size-10",
          tone === "danger"
            ? "border-rose/25 bg-rose/6 text-rose hover:bg-rose/12"
            : tone === "ghost"
              ? "border-transparent text-readout hover:bg-tint hover:text-ink"
              : "border-line bg-surface text-ink shadow-[0_1px_2px_rgb(15_20_48/0.06)] hover:border-violet/40 hover:bg-violet/6 hover:text-violet",
          className,
        )}
        onClick={(e) => {
          tipHandlers.onMouseLeave();
          onClick?.(e);
        }}
        {...tipHandlers}
        {...rest}
      >
        {icon}
      </button>
      <Tooltip anchor={tipRef} open={tipOpen} label={label} />
    </>
  );
}

/** 只有图标的链接，外观与 IconButton 一致 */
export function IconLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  const [tipRef, tipOpen, tipHandlers] = useTip<HTMLAnchorElement>();
  return (
    <>
      <Link
        ref={tipRef}
        href={href}
        aria-label={label}
        className="inline-grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-ink shadow-[0_1px_2px_rgb(15_20_48/0.06)] transition hover:border-violet/40 hover:bg-violet/6 hover:text-violet"
        {...tipHandlers}
      >
        {icon}
      </Link>
      <Tooltip anchor={tipRef} open={tipOpen} label={label} />
    </>
  );
}

/** 基于原生 <dialog> 的弹窗：自带焦点管理、Esc 关闭、点遮罩关闭 */
export function Modal({
  open,
  onClose,
  title,
  icon,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto max-h-[88vh] w-[calc(100%-2rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-[0_30px_100px_-24px_rgb(37_99_235/0.35)] backdrop:bg-transparent open:animate-modal",
        wide ? "max-w-4xl" : "max-w-xl",
      )}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <header className="flex items-center gap-3 border-b border-line px-6 py-4">
            {icon}
            <h2 className="flex-1 text-base font-semibold">{title}</h2>
            <IconButton label="关闭" tone="ghost" size="sm" icon={<X size={18} />} onClick={onClose} />
          </header>
          <div className="overflow-x-hidden overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Pill({ tone, children }: { tone: "pass" | "warn" | "fail" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone === "pass" && "bg-mint/12 text-mint",
        tone === "warn" && "bg-amber/12 text-amber",
        tone === "fail" && "bg-rose/12 text-rose",
        tone === "muted" && "bg-tint text-readout",
      )}
    >
      {children}
    </span>
  );
}

export function Panel({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section
      className={cx(
        "rounded-3xl border border-line bg-surface/85 shadow-[0_1px_2px_rgb(15_20_48/0.04),0_16px_48px_-24px_rgb(37_99_235/0.22)] backdrop-blur-xl",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-readout">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full min-w-0 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-ink outline-none transition placeholder:text-faint focus:border-violet focus:bg-surface focus:shadow-[0_0_0_4px_rgb(124_58_237/0.12)]";
