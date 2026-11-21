import { expect, it } from "vitest";
import { mergeBackup, parseBackup, sameLibrary } from "./backup";
import { demoTools } from "./demo";
import { isPublishableKey } from "./public-config";

it("rejects invalid versions, duplicate IDs and damaged notes without partial import", () => {
  expect(() => parseBackup('{"version":2,"tools":[]}')).toThrow();
  expect(() =>
    parseBackup(
      JSON.stringify({ version: 1, tools: [demoTools[0], demoTools[0]] }),
    ),
  ).toThrow();
  expect(() =>
    parseBackup(
      JSON.stringify({
        version: 1,
        tools: [
          {
            ...demoTools[0],
            trials: [
              {
                id: "x",
                date: "2026-02-30",
                environment: "",
                notes: "x",
                verdict: "继续观察",
              },
            ],
          },
        ],
      }),
    ),
  ).toThrow();
});

it("skips exact duplicates, blocks changed text and preserves all original content", () => {
  const tool = {
    ...structuredClone(demoTools[0]),
    trials: [
      {
        id: "note",
        date: "2026-11-21",
        environment: "  iPhone  ",
        notes: "\n  原文 🧪\n最后一行  \n",
        verdict: "继续观察" as const,
      },
    ],
  };
  const incoming = parseBackup(JSON.stringify({ version: 1, tools: [tool] }));
  expect(mergeBackup([], incoming)).toMatchObject({
    tools: [tool],
    added: 1,
    skipped: 0,
    conflicts: [],
  });
  expect(mergeBackup([tool], incoming)).toMatchObject({
    added: 0,
    skipped: 1,
    conflicts: [],
  });
  expect(
    mergeBackup([tool], [{ ...tool, description: "different" }]),
  ).toMatchObject({ added: 0, conflicts: [tool.name] });
  expect(tool.trials[0].notes).toBe("\n  原文 🧪\n最后一行  \n");
  expect(sameLibrary(incoming, [tool])).toBe(true);
  expect(
    sameLibrary(
      [tool],
      [
        {
          ...tool,
          trials: [{ ...tool.trials[0], notes: tool.trials[0].notes.trim() }],
        },
      ],
    ),
  ).toBe(false);
});

it("refuses service role, secret and malformed keys before browser builds", () => {
  const jwt = (role: string) =>
    `header.${btoa(JSON.stringify({ role }))}.signature`;
  expect(isPublishableKey(jwt("anon"))).toBe(true);
  expect(isPublishableKey(jwt("service_role"))).toBe(false);
  expect(isPublishableKey("sb_secret_synthetic_only")).toBe(false);
  expect(isPublishableKey("sb_publishable_synthetic_only")).toBe(true);
  expect(isPublishableKey("malformed")).toBe(false);
});

it("preflights new categories and tried status without changing the existing library", () => {
  const tools = (["AI 编程", "AI 助手", "效率工具"] as const).map(
    (category, index) => ({
      ...structuredClone(demoTools[0]),
      id: `new-category-${index}`,
      category,
      status: index === 1 ? ("已试用" as const) : ("试用中" as const),
    }),
  );
  const existing = structuredClone([demoTools[0]]);
  const before = JSON.stringify(existing);
  const incoming = parseBackup(JSON.stringify({ version: 1, tools }));
  const result = mergeBackup(existing, incoming);
  expect(result).toEqual({
    tools: [...existing, ...tools],
    added: 3,
    skipped: 0,
    conflicts: [],
  });
  expect(JSON.stringify(existing)).toBe(before);
  expect(sameLibrary(incoming, tools)).toBe(true);
  expect(() =>
    parseBackup(
      JSON.stringify({ version: 1, tools: [{ ...tools[0], category: "invalid" }] }),
    ),
  ).toThrow();
  expect(() =>
    parseBackup(
      JSON.stringify({ version: 1, tools: [{ ...tools[0], status: "invalid" }] }),
    ),
  ).toThrow();
});
