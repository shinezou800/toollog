import { normalizeTool, today, type Tool } from "./model";

export function parseBackup(raw: string): Tool[] {
  if (raw.length > 2_000_000)
    throw new Error("备份超过 2 MB，请分批整理后重试。");
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== 1 ||
    !("tools" in data) ||
    !Array.isArray(data.tools) ||
    data.tools.some((tool) => normalizeTool(tool) === null)
  ) {
    throw new Error("备份格式损坏或版本不支持；未修改任何本机或云端记录。");
  }
  const tools = data.tools.map(normalizeTool) as Tool[];
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length)
    throw new Error("备份格式损坏或版本不支持；未修改任何本机或云端记录。");
  return tools;
}

// Compare structure rather than object property order; never trim saved text.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function mergeBackup(current: Tool[], incoming: Tool[]) {
  const merged = structuredClone(current);
  const conflicts: string[] = [];
  let added = 0,
    skipped = 0;
  for (const tool of incoming) {
    const existing = merged.find((item) => item.id === tool.id);
    if (!existing) {
      merged.push(structuredClone(tool));
      added++;
    } else if (sameLibrary([existing], [tool])) skipped++;
    else conflicts.push(tool.name);
  }
  return { tools: merged, added, skipped, conflicts };
}

export function sameLibrary(a: Tool[], b: Tool[]) {
  const sorted = (tools: Tool[]) =>
    [...tools]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map((tool) => ({
        ...tool,
        trials: [...tool.trials].sort((x, y) => x.id.localeCompare(y.id)),
      }));
  return canonical(sorted(a)) === canonical(sorted(b));
}

export function downloadBackup(raw: string, label = "toollog") {
  const url = URL.createObjectURL(
    new Blob([raw], { type: "application/json" }),
  );
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${label}-${today()}.json`;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
