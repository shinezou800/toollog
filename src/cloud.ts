import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseBackup } from "./backup";
import type { Repository } from "./repository";
import type { Tool } from "./model";
import type { Snapshot } from "./storage";
import { isPublishableKey } from "./public-config";

export function configuredClient(
  url: string,
  key: string,
): SupabaseClient | null {
  if (!url || !key) return null;
  if (!isPublishableKey(key))
    throw new Error(
      "配置不安全：浏览器只允许 publishable/anon key，禁止 service_role 或 secret key。",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname)
    )
  ) {
    throw new Error("云端项目必须使用 HTTPS。");
  }
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export interface CloudSnapshot extends Snapshot {
  importEnabled: boolean;
}
export function decodeSnapshot(data: unknown): CloudSnapshot {
  if (
    !data ||
    typeof data !== "object" ||
    !("revision" in data) ||
    typeof data.revision !== "number" ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !("importEnabled" in data) ||
    typeof data.importEnabled !== "boolean"
  )
    throw new Error("云端响应不完整，未替换当前记录。");
  return {
    tools: parseBackup(JSON.stringify(data)),
    raw: String(data.revision),
    error: null,
    importEnabled: data.importEnabled,
  };
}

export function cloudError(code?: string, message = "") {
  if (message.includes("STALE_REVISION"))
    return new Error(
      "另一设备已修改记录。请复制未保存草稿，刷新后再编辑；未覆盖云端内容。",
    );
  if (message.includes("IMPORT_LOCKED"))
    return new Error("导入尚未开放：请先备份，等待你确认后再导入。");
  if (code === "42501" || message.includes("ADMIN_ONLY"))
    return new Error(
      "当前账号没有管理员权限，或登录已过期。请退出后重新登录。",
    );
  if (message.includes("DELETION_NOT_SUPPORTED"))
    return new Error("记录有变化，为防止丢失数据已拒绝覆盖，请刷新后重试。");
  return new Error(
    "云端请求失败，未确认保存成功；草稿仍保留。请检查网络、项目暂停状态或重新登录后重试。",
  );
}

export class CloudRepository implements Repository {
  readonly kind = "cloud" as const;
  constructor(private client: SupabaseClient) {}
  async load(): Promise<CloudSnapshot> {
    const { data, error } = await this.client.rpc("toollog_load");
    if (error) throw cloudError(error.code, error.message);
    return decodeSnapshot(data);
  }
  async write(
    tools: Tool[],
    revision: string | null,
    importing = false,
  ): Promise<CloudSnapshot> {
    if (revision === null || !/^\d+$/.test(revision))
      throw new Error("云端版本缺失，请刷新后重试。");
    const { data, error } = await this.client.rpc("toollog_save", {
      p_tools: tools,
      p_revision: Number(revision),
      p_import: importing,
    });
    if (error) throw cloudError(error.code, error.message);
    return decodeSnapshot(data);
  }
  async save(tools: Tool[], revision: string | null) {
    return (await this.write(tools, revision)).raw!;
  }
}
