export const statuses = ["待试用", "试用中", "常用", "已归档"] as const;
export type Status = (typeof statuses)[number];
export const categories = [
  "效率办公",
  "开发工具",
  "设计创作",
  "AI 工具",
  "生活实用",
  "其他",
] as const;
export type Category = (typeof categories)[number];
export const verdicts = ["值得推荐", "继续观察", "暂不适合"] as const;
export type Verdict = (typeof verdicts)[number];
export const TOOL_METADATA_TEXT_LIMIT = 200;

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
  freeQuota: string | null;
  cardRequired: boolean | null;
  cost: string | null;
  expiresOn: string | null;
  rating: number | null;
}
export type ToolInput = Pick<
  Tool,
  | "name"
  | "description"
  | "url"
  | "category"
  | "status"
  | "freeQuota"
  | "cardRequired"
  | "cost"
  | "expiresOn"
  | "rating"
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

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "0001-01-01" &&
    value <= "9999-12-31" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function validateTool(tool: ToolInput): string | null {
  if (!tool.name.trim() || tool.name.trim().length > 80)
    return "请填写工具名称（1–80 字）。";
  if (tool.description.length > 500) return "一句话介绍不能超过 500 字。";
  if (tool.url.length > 2048 || !safeUrl(tool.url))
    return "请输入完整的 http:// 或 https:// 网址，不含账号密码。";
  if (!categories.includes(tool.category) || !statuses.includes(tool.status))
    return "请选择有效的分类和状态。";
  if (
    tool.freeQuota !== null &&
    (typeof tool.freeQuota !== "string" ||
      tool.freeQuota.length > TOOL_METADATA_TEXT_LIMIT)
  )
    return "免费额度不能超过 200 字。";
  if (tool.cardRequired !== null && typeof tool.cardRequired !== "boolean")
    return "请选择有效的绑卡要求。";
  if (
    tool.cost !== null &&
    (typeof tool.cost !== "string" ||
      tool.cost.length > TOOL_METADATA_TEXT_LIMIT)
  )
    return "费用不能超过 200 字。";
  if (tool.expiresOn !== null && !validIsoDate(tool.expiresOn))
    return "请选择有效的到期日。";
  if (
    tool.rating !== null &&
    (!Number.isInteger(tool.rating) || tool.rating < 1 || tool.rating > 5)
  )
    return "评分请选择 1–5 分。";
  return null;
}

export function validateTrial(trial: Omit<Trial, "id">): string | null {
  if (!validIsoDate(trial.date)) return "请选择有效的试用日期。";
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
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

// Version 1 backups and pre-migration cloud snapshots lack these keys. Add only
// missing values in memory; invalid values that are present remain a hard error.
export function normalizeTool(value: unknown): Tool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tool = value as Record<string, unknown>;
  const normalized = {
    ...tool,
    freeQuota: tool.freeQuota === undefined ? null : tool.freeQuota,
    cardRequired: tool.cardRequired === undefined ? null : tool.cardRequired,
    cost: tool.cost === undefined ? null : tool.cost,
    expiresOn: tool.expiresOn === undefined ? null : tool.expiresOn,
    rating: tool.rating === undefined ? null : tool.rating,
  };
  return isTool(normalized) ? normalized : null;
}
