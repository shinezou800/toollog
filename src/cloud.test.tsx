import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import App from "./App";
import CloudApp, { AuthenticatedApp } from "./CloudApp";
import { CloudRepository, decodeSnapshot } from "./cloud";
import { demoTools } from "./demo";
import { STORAGE_KEY } from "./storage";
import type { Repository } from "./repository";
import MigrationPanel from "./MigrationPanel";

const response = { version: 1, tools: [], revision: 0, importEnabled: false };

it("normalizes metadata missing from a pre-migration cloud snapshot", () => {
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
  const snapshot = decodeSnapshot({
    version: 1,
    tools: [legacyTool],
    revision: 8,
    importEnabled: false,
  });
  expect(snapshot.tools[0]).toMatchObject({
    freeQuota: null,
    cardRequired: null,
    cost: null,
    expiresOn: null,
    rating: null,
  });
  expect(snapshot.raw).toBe("8");
});

it("locks an unconfigured cloud build instead of revealing local records", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tools: demoTools }),
  );
  render(
    <CloudApp
      environment={{
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_PUBLISHABLE_KEY: "",
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "云端连接尚未就绪" }),
  ).toBeVisible();
  expect(screen.queryByText("Notion")).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEY)).toContain("Notion");
});

it("binds saves to a cloud revision, refuses stale writes and never stores records locally", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: response, error: null })
    .mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "STALE_REVISION" },
    });
  const repository = new CloudRepository({ rpc } as unknown as SupabaseClient);
  const tools = [
    {
      ...demoTools[0],
      freeQuota: "每月 100 次",
      cardRequired: false,
      cost: "$12 / 月",
      expiresOn: "2026-12-31",
      rating: 5,
    },
  ];
  expect((await repository.load()).raw).toBe("0");
  await expect(repository.save(tools, "0")).rejects.toThrow("另一设备");
  expect(rpc).toHaveBeenLastCalledWith("toollog_save", {
    p_tools: tools,
    p_revision: 0,
    p_import: false,
  });
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("does not refresh a pristine editor behind its back and retains a rejected cloud draft", async () => {
  const user = userEvent.setup();
  const repository: Repository = {
    kind: "cloud",
    load: vi
      .fn()
      .mockResolvedValue({ tools: demoTools, raw: "5", error: null }),
    save: vi.fn().mockRejectedValue(new Error("另一设备已修改记录")),
  };
  render(
    <App
      repository={repository}
      initial={{ tools: demoTools, raw: "4", error: null }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Notion/ }));
  await user.click(screen.getByRole("button", { name: "编辑工具" }));
  fireEvent(window, new Event("focus"));
  expect(repository.load).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("工具名称 *"), "草稿");
  await user.click(screen.getByRole("button", { name: "保存工具" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("另一设备");
  expect(screen.getByLabelText("工具名称 *")).toHaveValue("Notion草稿");
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("refreshes cloud exports and refuses to export stale cache on a network failure", async () => {
  const user = userEvent.setup();
  const repository: Repository = {
    kind: "cloud",
    load: vi.fn().mockRejectedValue(new Error("offline")),
    save: vi.fn(),
  };
  render(
    <App
      repository={repository}
      initial={{ tools: demoTools, raw: "1", error: null }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "导出备份" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未生成过期备份");
});

it("does not show records for a second authenticated user and clears data on signout", async () => {
  let listener: (event: string, session: Session | null) => void = () => {};
  const rpc = vi
    .fn()
    .mockResolvedValue({
      data: null,
      error: { code: "42501", message: "ADMIN_ONLY" },
    });
  const client = {
    rpc,
    auth: {
      onAuthStateChange: vi.fn((callback: typeof listener) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as SupabaseClient;
  const user = userEvent.setup();
  render(<AuthenticatedApp client={client} />);
  const session = { user: { id: "second-user" } } as Session;
  await act(async () => listener("SIGNED_IN", session));
  expect(await screen.findByRole("alert")).toHaveTextContent("唯一管理员");
  expect(
    screen.queryByRole("button", { name: "添加工具" }),
  ).not.toBeInTheDocument();
  rpc.mockResolvedValue({
    data: { ...response, tools: demoTools },
    error: null,
  });
  await user.click(screen.getByRole("button", { name: "重试连接" }));
  expect(await screen.findByText("Notion")).toBeVisible();
  await act(async () => listener("SIGNED_OUT", null));
  expect(screen.queryByText("Notion")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登录私密工具库" })).toBeVisible();
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("previews local data without uploading and keeps import locked pending owner approval", async () => {
  const user = userEvent.setup();
  const raw = JSON.stringify({ version: 1, tools: [demoTools[0]] });
  localStorage.setItem(STORAGE_KEY, raw);
  const repository = {
    load: vi
      .fn()
      .mockResolvedValue({
        tools: [],
        raw: "0",
        error: null,
        importEnabled: false,
      }),
    write: vi.fn(),
  } as unknown as CloudRepository;
  render(<MigrationPanel repository={repository} onImported={vi.fn()} />);
  await user.click(screen.getByText("旧数据迁移 · 先备份，确认后才上传"));
  await user.click(screen.getByRole("button", { name: "预检本机旧记录" }));
  expect(await screen.findByText(/真实数据导入尚未开放/)).toBeVisible();
  await user.click(screen.getByLabelText(/我已另外保存/));
  await user.click(screen.getByLabelText(/我确认将以上数据上传/));
  expect(screen.getByRole("button", { name: "确认导入云端" })).toBeDisabled();
  expect(repository.write).not.toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
});
