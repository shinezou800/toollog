import { normalizeTool, type Tool } from "./model";

export const STORAGE_KEY = "toollog.v1";
export interface Snapshot {
  tools: Tool[];
  raw: string | null;
  error: string | null;
}

export function loadTools(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { tools: [], raw, error: null };
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      !("version" in data) ||
      data.version !== 1 ||
      !("tools" in data) ||
      !Array.isArray(data.tools) ||
      data.tools.some((tool) => normalizeTool(tool) === null)
    )
      throw new Error("invalid data");
    const tools = data.tools.map(normalizeTool) as Tool[];
    if (new Set(tools.map((tool) => tool.id)).size !== tools.length)
      throw new Error("invalid data");
    return { tools, raw, error: null };
  } catch {
    return {
      tools: [],
      raw: null,
      error:
        "无法读取本机数据。请保留此浏览器的数据，并检查存储权限或恢复备份；为保护原记录，暂不允许覆盖保存。",
    };
  }
}

// Read/write IndexedDB transactions serialize saves across tabs, including HTTP
// LAN origins where Web Locks is unavailable. The actual library stays in
// localStorage; this empty store is only a browser-managed exclusive write lock.
export function saveTools(
  tools: Tool[],
  previousRaw: string | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const unavailable = () =>
      new Error(
        "保存失败：无法取得浏览器写入锁。请检查存储权限后重试；表单内容仍保留。",
      );
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open("toollog-write-lock", 1);
    } catch {
      reject(unavailable());
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore("lock");
    request.onerror = () => reject(unavailable());
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("lock", "readwrite");
      let raw: string;
      transaction.oncomplete = () => {
        database.close();
        resolve(raw);
      };
      transaction.onabort = () => {
        database.close();
        reject(unavailable());
      };
      transaction.objectStore("lock").get("writer").onsuccess = () => {
        try {
          raw = writeTools(tools, previousRaw);
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
    };
  });
}

function writeTools(tools: Tool[], previousRaw: string | null): string {
  let current: string | null;
  try {
    current = localStorage.getItem(STORAGE_KEY);
  } catch {
    throw new Error(
      "浏览器无法访问本地存储。请检查存储权限后重试；表单内容仍保留。",
    );
  }
  if (current !== previousRaw)
    throw new Error(
      "另一页面已修改记录。请先复制未保存内容，再刷新页面查看最新记录。",
    );
  const raw = JSON.stringify({ version: 1, tools });
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    throw new Error(
      "保存失败：本地存储不可用或空间不足。请检查浏览器设置后重试；表单内容仍保留。",
    );
  }
  return raw;
}
