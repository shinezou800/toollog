import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "./App";
import { loadTools, STORAGE_KEY } from "./storage";
import { demoTools } from "./demo";

it("adds and edits a tool and trial, preserving changes after remount", async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await user.click(screen.getByRole("button", { name: "添加第一个工具" }));
  await user.type(screen.getByLabelText("工具名称 *"), "我的测试工具");
  await user.type(screen.getByLabelText(/一句话介绍/), "用来整理想法");
  await user.type(screen.getByLabelText(/工具网址/), "https://example.com");
  await user.selectOptions(screen.getByLabelText("使用状态"), "试用中");
  await user.click(screen.getByRole("button", { name: "保存工具" }));
  expect(
    await screen.findByRole("heading", { name: "我的测试工具" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "编辑工具" }));
  await user.clear(screen.getByLabelText("工具名称 *"));
  await user.type(screen.getByLabelText("工具名称 *"), "改名后的工具");
  await user.click(screen.getByRole("button", { name: "保存工具" }));
  await screen.findByRole("heading", { name: "改名后的工具" });
  await user.click(screen.getByRole("button", { name: "写手记" }));
  await user.type(screen.getByLabelText(/使用环境/), "手机浏览器");
  await user.type(
    screen.getByLabelText(/试用笔记/),
    "第一次试用，操作很顺手。",
  );
  await user.click(screen.getByRole("button", { name: "保存手记" }));
  await screen.findByText("第一次试用，操作很顺手。");
  await user.click(screen.getByRole("button", { name: /编辑 .* 手记/ }));
  await user.type(screen.getByLabelText(/试用笔记/), " 下次继续。");
  await user.selectOptions(screen.getByLabelText("试用结论"), "值得推荐");
  await user.click(screen.getByRole("button", { name: "保存手记" }));
  await screen.findByText("第一次试用，操作很顺手。 下次继续。");
  expect(loadTools().tools[0].trials[0].notes).toContain("下次继续");
  app.unmount();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /改名后的工具/ }));
  expect(screen.getByText("第一次试用，操作很顺手。 下次继续。")).toBeVisible();
  expect(screen.getByText("值得推荐")).toBeVisible();
});

it("offers explicit synthetic examples, combines filters and clears empty results", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(screen.queryByText("Notion")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /先看看示例/ }));
  await screen.findByText("Notion");
  expect(loadTools().tools).toHaveLength(6);
  await user.type(screen.getByRole("textbox", { name: "搜索工具" }), "notion");
  expect(screen.getByText("Notion")).toBeVisible();
  expect(screen.queryByText("Raycast")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "试用中 2" }));
  expect(screen.getByText("没有找到匹配的工具")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  await user.selectOptions(screen.getByLabelText("分类筛选"), "设计创作");
  expect(screen.getByText("Figma")).toBeVisible();
  expect(screen.queryByText("Notion")).not.toBeInTheDocument();
});

it("keeps a draft and reports a quota failure, allowing retry", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "添加第一个工具" }));
  await user.type(screen.getByLabelText("工具名称 *"), "不能丢的草稿");
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
  await user.click(screen.getByRole("button", { name: "保存工具" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(screen.getByLabelText("工具名称 *")).toHaveValue("不能丢的草稿");
  write.mockRestore();
  await user.click(screen.getByRole("button", { name: "保存工具" }));
  expect(
    await screen.findByRole("heading", { name: "不能丢的草稿" }),
  ).toBeVisible();
});

it("guards invalid input and blocks overwriting corrupt data", async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await user.click(screen.getByRole("button", { name: "添加第一个工具" }));
  await user.type(screen.getByLabelText("工具名称 *"), "   ");
  await user.click(screen.getByRole("button", { name: "保存工具" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请填写工具名称");
  app.unmount();
  localStorage.setItem(STORAGE_KEY, "{bad");
  render(<App />);
  expect(screen.getByRole("alert")).toHaveTextContent("为保护原记录");
  expect(screen.getByRole("button", { name: "添加第一个工具" })).toBeDisabled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe("{bad");
});

it("warns about unsaved navigation and remote changes", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "添加第一个工具" }));
  await user.type(screen.getByLabelText("工具名称 *"), "还没写完");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await user.click(screen.getByRole("button", { name: "取消并返回" }));
  expect(screen.getByLabelText("工具名称 *")).toHaveValue("还没写完");
  fireEvent(window, new StorageEvent("storage", { key: STORAGE_KEY }));
  expect(
    within(screen.getByRole("status")).getByText(/另一页面已更新数据/),
  ).toBeVisible();
});

it("exports the latest persisted library rather than a stale tab snapshot", async () => {
  const user = userEvent.setup();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tools: [demoTools[0]] }),
  );
  render(<App />);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tools: demoTools }),
  );
  fireEvent(window, new StorageEvent("storage", { key: STORAGE_KEY }));
  let contents = "";
  const OriginalBlob = Blob;
  vi.stubGlobal(
    "Blob",
    class extends OriginalBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        contents = String(parts[0]);
      }
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:backup";
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await user.click(screen.getByRole("button", { name: "导出备份" }));
    expect(JSON.parse(contents).tools).toHaveLength(6);
    expect(screen.getByRole("status")).toHaveTextContent("另一页面有更新");
    expect(screen.queryByText("Raycast")).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});
