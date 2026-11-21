import { useState } from "react";
import {
  downloadBackup,
  mergeBackup,
  parseBackup,
  sameLibrary,
} from "./backup";
import type { Tool } from "./model";
import type { CloudRepository, CloudSnapshot } from "./cloud";
import { STORAGE_KEY } from "./storage";

export default function MigrationPanel({
  repository,
  onImported,
}: {
  repository: CloudRepository;
  onImported: () => void;
}) {
  const [incoming, setIncoming] = useState<Tool[] | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof mergeBackup> | null>(
    null,
  );
  const [target, setTarget] = useState<CloudSnapshot | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function inspect(raw: string) {
    setBusy(true);
    setMessage("");
    setConfirmed(false);
    setPreview(null);
    setIncoming(null);
    try {
      const tools = parseBackup(raw);
      const latest = await repository.load();
      setIncoming(tools);
      setTarget(latest);
      setPreview(mergeBackup(latest.tools, tools));
    } catch {
      setMessage(
        "无法预检：请确认 JSON 备份格式、登录和网络；未上传或删除任何记录。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="migration-panel">
      <summary>旧数据迁移 · 先备份，确认后才上传</summary>
      <p>
        旧记录仍属于原浏览器与原网址。换过网址时，请从原预览导出
        JSON，再在这里预检。此处不会清除本机副本。
      </p>
      <div className="migration-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            try {
              const raw = localStorage.getItem(STORAGE_KEY);
              if (raw === null) throw new Error();
              downloadBackup(raw, "toollog-local-original");
              setMessage(
                "已请求下载本机原始备份；请检查下载文件并另外妥善保存。",
              );
            } catch {
              setMessage(
                "此浏览器/网址没有可备份的数据，或下载失败。请回原浏览器和原预览导出；不要清除站点数据。",
              );
            }
          }}
        >
          下载本机原始备份
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            try {
              const raw = localStorage.getItem(STORAGE_KEY);
              if (raw === null) throw new Error();
              void inspect(raw);
            } catch {
              setMessage(
                "当前网址未找到旧记录；请选取原网址导出的 JSON 备份。",
              );
            }
          }}
        >
          预检本机旧记录
        </button>
        <label className="field">
          选取旧 JSON 备份（仅预检）
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              if (file.size > 2_000_000) {
                setIncoming(null);
                setPreview(null);
                setMessage("文件超过 2 MB，未读取或上传。");
                return;
              }
              try {
                await inspect(await file.text());
              } catch {
                setMessage("读取备份文件失败，未上传数据。");
              }
            }}
          />
        </label>
      </div>
      {incoming && preview && target && (
        <div>
          <p>
            待核对：{incoming.length} 个工具、
            {incoming.reduce((n, t) => n + t.trials.length, 0)} 篇手记；新增{" "}
            {preview.added} 个工具，完全相同跳过 {preview.skipped} 个。
          </p>
          {preview.conflicts.length > 0 && (
            <p role="alert">
              发现同 ID 不同内容：{preview.conflicts.join("、")}
              。不会覆盖，请先分别备份并人工整理后重新预检。
            </p>
          )}
          <ul className="migration-records">
            {incoming.map((tool) => (
              <li key={tool.id}>
                <details>
                  <summary>
                    {tool.name} · {tool.trials.length} 篇手记
                  </summary>
                  <pre>{JSON.stringify(tool, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          <label className="check-line">
            <input
              type="checkbox"
              checked={backedUp}
              onChange={(event) => setBackedUp(event.target.checked)}
            />
            我已另外保存原始备份，并核对以上数量和逐条内容
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我确认将以上数据上传到当前管理员的云端工具库
          </label>
          {!target.importEnabled && (
            <p>
              真实数据导入尚未开放。请先完成备份并在对话中确认，随后才会解锁；预检不上传数据。
            </p>
          )}
          <button
            className="button primary"
            disabled={
              busy ||
              !backedUp ||
              !confirmed ||
              !target.importEnabled ||
              !!preview.conflicts.length ||
              !preview.added
            }
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                // Server CAS binds this exact preview to its reviewed revision. Never
                // merge a new, unseen cloud snapshot behind the confirmation dialog.
                const saved = await repository.write(
                  preview.tools,
                  target.raw,
                  true,
                );
                const readBack = await repository.load();
                if (
                  !sameLibrary(saved.tools, preview.tools) ||
                  !sameLibrary(readBack.tools, preview.tools)
                ) {
                  throw new Error(
                    "读回内容与预检不一致：请保留原备份并导出云端核对，勿重复导入。",
                  );
                }
                setMessage("导入已保存并逐条读回核对一致。本机原记录未删除。");
                setIncoming(null);
                setPreview(null);
                onImported();
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "导入失败，原始备份与本机数据未删除。",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在核对…" : "确认导入云端"}
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
