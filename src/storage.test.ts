import { describe, expect, it, vi } from "vitest";
import { demoTools } from "./demo";
import { loadTools, saveTools, STORAGE_KEY } from "./storage";
import {
  createId,
  isTool,
  safeUrl,
  validateTool,
  validateTrial,
} from "./model";

describe("record validation", () => {
  it("creates unique IDs without secure-context-only randomUUID", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("Unavailable over HTTP");
    });
    expect(createId()).toMatch(/^[a-f0-9]{32}$/);
    expect(createId()).not.toBe(createId());
  });
  it("rejects executable links and links containing credentials", () => {
    expect(safeUrl("javascript:alert(1)")).toBe(false);
    expect(safeUrl("data:text/html,hello")).toBe(false);
    expect(safeUrl("https://user:password@example.com")).toBe(false);
    expect(safeUrl("https://example.com/path?q=one")).toBe(true);
    expect(safeUrl("")).toBe(true);
  });
  it("rejects blank names, invalid status and dates and blank notes", () => {
    expect(validateTool({ ...demoTools[0], name: "  " })).not.toBeNull();
    expect(isTool({ ...demoTools[0], status: "unknown" })).toBe(false);
    expect(
      validateTrial({
        date: "2026-02-30",
        environment: "",
        verdict: "继续观察",
        notes: "测试",
      }),
    ).not.toBeNull();
    expect(
      validateTrial({
        date: "2026-02-28",
        environment: "",
        verdict: "继续观察",
        notes: "  ",
      }),
    ).not.toBeNull();
    expect(demoTools.every(isTool)).toBe(true);
  });
  it("validates nullable metadata, ISO expiration dates and 1–5 integer ratings", () => {
    expect(validateTool({ ...demoTools[0], freeQuota: "x".repeat(201) })).toContain("免费额度");
    expect(validateTool({ ...demoTools[0], cost: "x".repeat(201) })).toContain("费用");
    expect(validateTool({ ...demoTools[0], cardRequired: "yes" as never })).toContain("绑卡");
    expect(validateTool({ ...demoTools[0], expiresOn: "2026-02-30" })).toContain("到期日");
    expect(validateTool({ ...demoTools[0], rating: 4.5 })).toContain("1–5");
    expect(validateTool({ ...demoTools[0], rating: 0 })).toContain("1–5");
    expect(validateTool({ ...demoTools[0], rating: 5 })).toBeNull();
  });
});

describe("local persistence", () => {
  it("starts empty and round-trips records and trials", async () => {
    expect(loadTools()).toEqual({ tools: [], raw: null, error: null });
    const raw = await saveTools(demoTools, null);
    expect(loadTools()).toEqual({ tools: demoTools, raw, error: null });
  });
  it.each([
    "broken JSON",
    '{"version":2,"tools":[]}',
    '{"version":1,"tools":[{}]}',
    JSON.stringify({ version: 1, tools: [demoTools[0], demoTools[0]] }),
  ])("preserves invalid data instead of silently replacing it: %s", (raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadTools().error).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it("normalizes legacy version 1 records without rewriting their stored JSON", () => {
    const legacyTool = JSON.parse(JSON.stringify(demoTools[0])) as Record<
      string,
      unknown
    >;
    for (const field of [
      "freeQuota",
      "cardRequired",
      "cost",
      "expiresOn",
      "rating",
    ])
      delete legacyTool[field];
    const raw = JSON.stringify({ version: 1, tools: [legacyTool] });
    localStorage.setItem(STORAGE_KEY, raw);
    const snapshot = loadTools();
    expect(snapshot.error).toBeNull();
    expect(snapshot.tools[0]).toMatchObject({
      freeQuota: null,
      cardRequired: null,
      cost: null,
      expiresOn: null,
      rating: null,
    });
    expect(snapshot.raw).toBe(raw);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it("rejects stale writes from another tab", async () => {
    await saveTools(demoTools, null);
    await expect(saveTools([], null)).rejects.toThrow("另一页面已修改记录");
    expect(loadTools().tools).toHaveLength(6);
  });
  it("serializes overlapping saves, rejecting the second stale snapshot", async () => {
    const results = await Promise.allSettled([
      saveTools([demoTools[0]], null),
      saveTools([demoTools[1]], null),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(loadTools().tools).toEqual([demoTools[0]]);
  });
  it("reports unavailable storage and failed writes", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(loadTools().error).toBeTruthy();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await expect(saveTools(demoTools, null)).rejects.toThrow("空间不足");
  });
});
