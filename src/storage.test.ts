import { describe, expect, it, vi } from "vitest";
import { demoTools } from "./demo";
import { loadTools, saveTools, STORAGE_KEY } from "./storage";
import { isTool, safeUrl, validateTool, validateTrial } from "./model";

describe("record validation", () => {
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
});

describe("local persistence", () => {
  it("starts empty and round-trips records and trials", () => {
    expect(loadTools()).toEqual({ tools: [], raw: null, error: null });
    const raw = saveTools(demoTools, null);
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
  it("rejects stale writes from another tab", () => {
    saveTools(demoTools, null);
    expect(() => saveTools([], null)).toThrow("另一页面已修改记录");
    expect(loadTools().tools).toHaveLength(6);
  });
  it("reports unavailable storage and failed writes", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(loadTools().error).toBeTruthy();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(() => saveTools(demoTools, null)).toThrow("空间不足");
  });
});
