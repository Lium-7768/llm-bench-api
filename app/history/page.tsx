"use client";

import { ChevronRight, Download, FileUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { ReportView } from "@/components/Report";
import { IconButton, Modal, Panel, Pill } from "@/components/ui";
import type { Report } from "@/lib/types";
import { errorReason, hasError } from "@/lib/web/format";
import { clearHistory, importHistory, removeHistory, useHistory } from "@/lib/web/storage";

export default function HistoryPage() {
  const history = useHistory();
  const [open, setOpen] = useState<Report | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(history ?? [], null, 2)], { type: "application/json" }));
    a.download = `llm-bench-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      setNote(`导入了 ${importHistory(JSON.parse(await file.text()))} 份新报告`);
    } catch {
      setNote("这个文件不是导出的报告 JSON");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">历史记录</h1>
          <p className="mt-2 text-sm text-readout">只保存在本浏览器，最多 60 份，不含密钥。换设备时导出再导入。</p>
        </div>
        <div className="flex gap-2">
          <IconButton label="导入报告" icon={<FileUp size={18} />} onClick={() => fileInput.current?.click()} />
          <IconButton label="导出全部" icon={<Download size={18} />} onClick={exportJson} disabled={!history?.length} />
          <IconButton
            label="清空历史"
            tone="danger"
            icon={<Trash2 size={18} />}
            onClick={() => setConfirmClear(true)}
            disabled={!history?.length}
          />
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
        </div>
      </div>
      {note && <p className="rounded-xl bg-tint px-4 py-2.5 text-sm text-readout">{note}</p>}

      {history !== null && history.length === 0 && (
        <Panel className="py-16 text-center text-readout">还没有报告。去「检测」页跑一次，结果会自动出现在这里。</Panel>
      )}

      <ul className="flex flex-col gap-2">
        {(history ?? []).map((r) =>
          hasError(r) ? (
            // 报错的报告结果不完整：不能查看详情，只能删除
            <li key={r.id}>
              <Panel className="flex items-center gap-2 pr-3">
                <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 opacity-75">
                  <span className="truncate font-medium">{r.model}</span>
                  <Pill tone="fail">报错</Pill>
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-readout" title={errorReason(r)}>
                    {errorReason(r)}
                  </span>
                </div>
                <IconButton
                  label="删除这条记录"
                  tone="ghost"
                  size="sm"
                  icon={<Trash2 size={15} />}
                  onClick={() => removeHistory(r.id)}
                />
              </Panel>
            </li>
          ) : (
            <li key={r.id}>
              <Panel className="flex items-center gap-2 pr-3 transition hover:border-ink/25">
                <button
                  type="button"
                  onClick={() => setOpen(r)}
                  aria-label={`查看 ${r.model} 的报告`}
                  className="group flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate font-medium group-hover:text-ink">{r.model}</span>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </button>
                <IconButton
                  label="删除这条记录"
                  tone="ghost"
                  size="sm"
                  icon={<Trash2 size={15} />}
                  onClick={() => removeHistory(r.id)}
                />
              </Panel>
            </li>
          ),
        )}
      </ul>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.model ?? ""} wide>
        {open && <ReportView report={open} />}
      </Modal>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空全部历史记录？"
        icon={<Trash2 size={18} className="text-rose" />}
      >
        <p className="text-sm text-readout">
          本浏览器里的 {history?.length ?? 0} 份报告会被删除，无法恢复。需要的话先导出备份。
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-tint"
            onClick={() => setConfirmClear(false)}
          >
            保留
          </button>
          <button
            className="rounded-xl bg-rose/90 px-4 py-2 text-sm font-semibold text-white hover:bg-rose"
            onClick={() => {
              clearHistory();
              setConfirmClear(false);
            }}
          >
            清空历史
          </button>
        </div>
      </Modal>
    </div>
  );
}
