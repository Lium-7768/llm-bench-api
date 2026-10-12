"use client";

import { Eye, EyeOff, ListRestart, LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { QUESTIONS } from "@/lib/bank";
import { PRESETS, PROTOCOL_LABELS } from "@/lib/presets";
import type { Protocol } from "@/lib/types";
import { postApi } from "@/lib/web/api";
import { useConfig } from "./ConfigProvider";
import { Combobox, Select } from "./Select";
import { Field, IconButton, cx, inputClass } from "./ui";

const PROTOCOLS = Object.keys(PROTOCOL_LABELS) as Protocol[];
const PROTOCOL_SHORT: Record<Protocol, string> = { openai: "OpenAI 兼容", anthropic: "Anthropic", gemini: "Gemini" };
const BASIC_COUNT = QUESTIONS.filter((q) => q.category !== "hallucination").length;

/** 被测接口配置：服务商、协议、地址、密钥、模型、题量 */
export function ConfigPanel() {
  const { config, update } = useConfig();
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const preset = PRESETS.find((p) => p.id === config.presetId) ?? PRESETS[PRESETS.length - 1];
  const suggestions = [...new Set([...models, ...preset.models])];

  const choosePreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setModels([]);
    setNote(null);
    update({ presetId: id, protocol: p.protocol, baseUrl: p.baseUrl || config.baseUrl, model: p.models[0] ?? "" });
  };

  const fetchModels = async () => {
    setLoading(true);
    setNote(null);
    try {
      const data = await postApi<{ models: string[] }>("/api/v1/models", config);
      setModels(data.models);
      setNote({ text: data.models.length ? `获取到 ${data.models.length} 个模型，在模型输入框里选择` : "接口没有返回模型列表，请手动填写模型 ID" });
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="服务商">
        <Select
          label="服务商"
          value={preset.id}
          onChange={choosePreset}
          options={PRESETS.map((p) => ({ value: p.id, label: p.name, hint: p.id === "custom" ? undefined : PROTOCOL_SHORT[p.protocol] }))}
        />
      </Field>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-readout">协议</span>
        <div className="flex gap-1 rounded-xl border border-line bg-paper p-1" role="radiogroup" aria-label="协议">
          {PROTOCOLS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={config.protocol === p}
              onClick={() => update({ protocol: p })}
              className={cx(
                "relative flex-1 rounded-lg px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                config.protocol === p ? "text-violet" : "text-readout hover:text-ink",
              )}
            >
              {config.protocol === p && (
                <motion.span
                  layoutId="protocol-pill"
                  className="absolute inset-0 rounded-lg bg-surface shadow-[0_1px_3px_rgb(15_20_48/0.12),0_0_0_1px_rgb(124_58_237/0.25)]"
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                />
              )}
              <span className="relative">{PROTOCOL_SHORT[p]}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label="接口地址" className="sm:col-span-2">
        <input
          className={inputClass}
          value={config.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value, presetId: "custom" })}
          placeholder="https://your-relay.com/v1"
          spellCheck={false}
          autoComplete="off"
        />
      </Field>

      <Field label="API Key（只保存在本浏览器）">
        <div className="flex gap-2">
          <input
            className={inputClass}
            type={showKey ? "text" : "password"}
            value={config.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
          />
          <IconButton
            label={showKey ? "隐藏密钥" : "显示密钥"}
            icon={showKey ? <EyeOff size={17} /> : <Eye size={17} />}
            onClick={() => setShowKey((v) => !v)}
          />
        </div>
      </Field>

      <Field label="模型">
        <div className="flex gap-2">
          <Combobox
            label="模型"
            value={config.model}
            onChange={(model) => update({ model })}
            suggestions={suggestions}
            placeholder="填写或选择模型 ID"
          />
          <IconButton
            label="从接口获取模型列表"
            icon={loading ? <LoaderCircle size={17} className="animate-spin" /> : <ListRestart size={17} />}
            onClick={fetchModels}
            disabled={loading || !config.apiKey || !config.baseUrl}
          />
        </div>
      </Field>

      {note && (
        <p className={cx("rounded-xl px-3.5 py-2.5 text-xs sm:col-span-2", note.error ? "bg-rose/12 text-rose" : "bg-tint text-readout")}>
          {note.text}
        </p>
      )}

      <Field label="基础测试题量">
        <Select
          label="基础测试题量"
          value={config.limit}
          onChange={(limit) => update({ limit })}
          options={[
            { value: 0, label: `全部 ${BASIC_COUNT} 题` },
            { value: 12, label: "抽 12 题" },
            { value: 6, label: "抽 6 题" },
          ]}
        />
      </Field>

      <Field label="随机种子（相同则题目和顺序相同）">
        <input className={inputClass} type="number" value={config.seed} onChange={(e) => update({ seed: Number(e.target.value) || 0 })} />
      </Field>

      <label className="flex cursor-pointer items-center gap-2.5 text-xs text-readout sm:col-span-2">
        <input
          type="checkbox"
          className="size-4 accent-violet"
          checked={config.rememberKey}
          onChange={(e) => update({ rememberKey: e.target.checked })}
        />
        记住密钥（关闭后只在当前标签页有效）
      </label>
    </div>
  );
}
