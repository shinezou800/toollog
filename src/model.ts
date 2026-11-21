export const statuses = ["待试用", "试用中", "常用", "已归档", "已试用"] as const;
export type Status = (typeof statuses)[number];
export const categories = [
  "效率办公",
  "开发工具",
  "设计创作",
  "AI 工具",
  "生活实用",
  "其他",
  "AI 编程",
  "AI 助手",
  "效率工具",
] as const;
export type Category = (typeof categories)[number];
export const verdicts = ["值得推荐", "继续观察", "暂不适合"] as const;
export type Verdict = (typeof verdicts)[number];

export interface Trial {
  id: string;
  date: string;
  environment: string;
  verdict: Verdict;
  notes: string;
}
export interface Tool {
  id: string;
  name: string;
  description: string;
  url: string;
  category: Category;
  status: Status;
  updatedAt: string;
  trials: Trial[];
}
export type ToolInput = Pick<
  Tool,
  "name" | "description" | "url" | "category" | "status"
>;

// getRandomValues is also available on HTTP LAN origins, unlike randomUUID.
export function createId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function safeUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function validateTool(tool: ToolInput): string | null {
  if (!tool.name.trim() || tool.name.trim().length > 80)
    return "请填写工具名称（1–80 字）。";
  if (tool.description.length > 500) return "一句话介绍不能超过 500 字。";
  if (tool.url.length > 2048 || !safeUrl(tool.url))
    return "请输入完整的 http:// 或 https:// 网址，不含账号密码。";
  if (!categories.includes(tool.category) || !statuses.includes(tool.status))
    return "请选择有效的分类和状态。";
  return null;
}

export function validateTrial(trial: Omit<Trial, "id">): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(trial.date) ||
    !Number.isFinite(Date.parse(trial.date)) ||
    new Date(trial.date).toISOString().slice(0, 10) !== trial.date
  )
    return "请选择有效的试用日期。";
  if (!trial.notes.trim() || trial.notes.length > 5000)
    return "请填写试用笔记（1–5000 字）。";
  if (trial.environment.length > 100) return "使用环境不能超过 100 字。";
  if (!verdicts.includes(trial.verdict)) return "请选择试用结论。";
  return null;
}

export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isTool(value: unknown): value is Tool {
  if (!value || typeof value !== "object") return false;
  const tool = value as Tool;
  return (
    typeof tool.id === "string" &&
    !!tool.id &&
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    typeof tool.url === "string" &&
    !validateTool(tool) &&
    typeof tool.updatedAt === "string" &&
    Number.isFinite(Date.parse(tool.updatedAt)) &&
    Array.isArray(tool.trials) &&
    tool.trials.every(
      (trial) =>
        trial &&
        typeof trial.id === "string" &&
        !!trial.id &&
        typeof trial.date === "string" &&
        typeof trial.environment === "string" &&
        typeof trial.notes === "string" &&
        !validateTrial(trial),
    ) &&
    new Set(tool.trials.map((trial) => trial.id)).size === tool.trials.length
  );
}
