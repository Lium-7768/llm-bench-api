"use client";

import { Check, ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnchoredLayer } from "./Layer";
import { cx, inputClass } from "./ui";

export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

/** 点击外部时关闭 */
function useOutside(open: boolean, refs: Array<React.RefObject<HTMLElement | null>>, onOutside: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (refs.every((r) => !r.current?.contains(e.target as Node))) onOutside();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [open, refs, onOutside]);
}

function ListBox<T>({
  id,
  options,
  active,
  selected,
  onPick,
  onHover,
  empty,
}: {
  id: string;
  options: Option<T>[];
  active: number;
  selected?: T;
  onPick: (o: Option<T>) => void;
  onHover: (i: number) => void;
  empty?: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <motion.ul
      ref={listRef}
      id={id}
      role="listbox"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className="max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_50px_-18px_rgb(15_20_48/0.35)]"
    >
      {options.length === 0 && <li className="px-3 py-2.5 text-sm text-faint">{empty ?? "没有匹配项"}</li>}
      {options.map((o, i) => {
        const isSelected = selected !== undefined && o.value === selected;
        return (
          <li
            key={String(o.value)}
            data-index={i}
            role="option"
            aria-selected={isSelected}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onPick(o)}
            onPointerEnter={() => onHover(i)}
            className={cx(
              "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
              i === active ? "bg-violet/8 text-violet" : "text-ink",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.hint && <span className="shrink-0 text-xs text-faint">{o.hint}</span>}
            {isSelected && <Check size={15} className="shrink-0 text-violet" />}
          </li>
        );
      })}
    </motion.ul>
  );
}

/** 下拉选择 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** 无障碍名称 */
  label: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(current);

  useOutside(open, [trigger, layer], () => setOpen(false));

  const openList = () => {
    setActive(current);
    setOpen(true);
  };
  const pick = (o: Option<T>) => {
    onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      return openList();
    }
    if (!open) return;
    if (e.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" || e.key === " ") pick(options[active]);
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Tab") return setOpen(false);
    else return;
    e.preventDefault();
    // 在弹窗里按 Esc 只关下拉，不关弹窗
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cx(inputClass, "flex items-center gap-2 text-left", open && "border-violet bg-surface shadow-[0_0_0_4px_rgb(124_58_237/0.12)]")}
      >
        <span className="min-w-0 flex-1 truncate">{options[current]?.label}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="shrink-0 text-readout">
          <ChevronDown size={17} />
        </motion.span>
      </button>
      <AnchoredLayer anchor={trigger} open={open} matchWidth gap={6} layerRef={layer}>
        <ListBox id={id} options={options} active={active} selected={value} onPick={pick} onHover={setActive} />
      </AnchoredLayer>
    </>
  );
}

/** 可自由输入、同时提供候选项的输入框 */
export function Combobox({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  label: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);

  useOutside(open, [input, layer], () => setOpen(false));

  // 刚打开或值正好是某个候选时显示全部，输入过程中按关键字过滤
  const q = value.trim().toLowerCase();
  const filtered = typed && q && !suggestions.includes(value) ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
  const options = filtered.map((s) => ({ value: s, label: s }));

  const pick = (o: Option<string>) => {
    onChange(o.value);
    setTyped(false);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      if (!open) setOpen(true);
      setActive((i) => Math.min(options.length - 1, open ? i + 1 : 0));
    } else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" && open && options[active]) pick(options[active]);
    else if (e.key === "Escape" && open) setOpen(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open && suggestions.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        className={inputClass}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          setTyped(false);
          setActive(0);
          setOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <AnchoredLayer anchor={input} open={open && suggestions.length > 0} matchWidth gap={6} layerRef={layer}>
        <ListBox id={id} options={options} active={active} selected={value} onPick={pick} onHover={setActive} empty="没有匹配的模型，直接使用输入的 ID" />
      </AnchoredLayer>
    </>
  );
}
