import type { Tool } from "./model";

// Synthetic examples only: not reviews or claims based on real testing.
export const demoTools: Tool[] = [
  {
    id: "demo-notion",
    name: "Notion",
    description: "把想法、文档和项目，放进同一个工作空间。",
    url: "https://www.notion.so",
    category: "效率办公",
    status: "常用",
    updatedAt: "2026-11-18T08:00:00Z",
    trials: [
      {
        id: "demo-trial-notion",
        date: "2026-11-18",
        environment: "桌面浏览器 · 示例",
        verdict: "值得推荐",
        notes:
          "【合成示例，非真实测评】用一个页面整理本周计划，表格和笔记放在一起很方便。下一次想试试手机端快速收集灵感的体验。",
      },
    ],
  },
  {
    id: "demo-raycast",
    name: "Raycast",
    description: "从一个搜索框开始，让日常操作更顺手。",
    url: "https://www.raycast.com",
    category: "效率办公",
    status: "试用中",
    updatedAt: "2026-11-17T08:00:00Z",
    trials: [
      {
        id: "demo-trial-raycast",
        date: "2026-11-17",
        environment: "macOS · 示例",
        verdict: "继续观察",
        notes:
          "【合成示例，非真实测评】先记录启动应用、剪贴板和快捷链接这几个使用场景。后续再看能否融入日常工作流。",
      },
    ],
  },
  {
    id: "demo-figma",
    name: "Figma",
    description: "从灵感到界面，一起把想法变成设计。",
    url: "https://www.figma.com",
    category: "设计创作",
    status: "常用",
    updatedAt: "2026-11-16T08:00:00Z",
    trials: [],
  },
  {
    id: "demo-obsidian",
    name: "Obsidian",
    description: "用双向链接，把零散的笔记串成知识网络。",
    url: "https://obsidian.md",
    category: "效率办公",
    status: "待试用",
    updatedAt: "2026-11-15T08:00:00Z",
    trials: [],
  },
  {
    id: "demo-cursor",
    name: "Cursor",
    description: "在熟悉的编辑器里，探索 AI 辅助编程。",
    url: "https://cursor.com",
    category: "开发工具",
    status: "待试用",
    updatedAt: "2026-11-14T08:00:00Z",
    trials: [],
  },
  {
    id: "demo-perplexity",
    name: "Perplexity",
    description: "带着问题搜索，为下一步探索找到线索。",
    url: "https://www.perplexity.ai",
    category: "AI 工具",
    status: "试用中",
    updatedAt: "2026-11-13T08:00:00Z",
    trials: [],
  },
];
