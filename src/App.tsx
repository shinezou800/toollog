import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Cloud,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Layers,
  Menu,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  categories,
  createId,
  statuses,
  today,
  validateTool,
  validateTrial,
  verdicts,
  type Tool,
  type ToolInput,
  type Trial,
} from "./model";
import { demoTools } from "./demo";
import { loadTools, STORAGE_KEY } from "./storage";
import type { Snapshot } from "./storage";
import { localRepository, type Repository } from "./repository";

type View =
  | { page: "library" }
  | { page: "detail"; id: string }
  | { page: "tool-form"; id?: string }
  | { page: "trial-form"; toolId: string; trialId?: string };
type Notice = { text: string; kind: "success" | "refresh" };
const emptyTool: ToolInput = {
  name: "",
  description: "",
  url: "",
  category: "效率办公",
  status: "待试用",
  freeQuota: null,
  cardRequired: null,
  cost: null,
  expiresOn: null,
  rating: null,
};
const iconClasses = ["blue", "purple", "orange", "green", "pink", "teal"];
const dateLabel = (date: string) => date.slice(0, 10).replaceAll("-", ".");

function ToolIcon({ tool, large = false }: { tool: Tool; large?: boolean }) {
  const color =
    iconClasses[
      Array.from(tool.name).reduce(
        (total, char) => total + char.charCodeAt(0),
        0,
      ) % iconClasses.length
    ];
  return (
    <span
      aria-hidden="true"
      className={`tool-icon ${color} ${large ? "large" : ""}`}
    >
      {tool.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
function StatusPill({ status }: { status: Tool["status"] }) {
  return (
    <span className={`status-pill status-${statuses.indexOf(status)}`}>
      <span />
      {status}
    </span>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function App({
  repository = localRepository,
  initial,
  onSignOut,
  libraryExtra,
}: {
  repository?: Repository;
  initial?: Snapshot;
  onSignOut?: () => Promise<void>;
  libraryExtra?: (onRefresh: () => void) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(
    () =>
      initial ??
      (repository.kind === "local"
        ? loadTools()
        : { tools: [], raw: null, error: "尚未读取云端记录，请重新登录。" }),
  );
  const cloud = repository.kind === "cloud";
  const [view, setView] = useState<View>({ page: "library" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部工具");
  const [category, setCategory] = useState("全部分类");
  const [message, setMessage] = useState<Notice | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const tools = snapshot.tools;
  const trialsCount = tools.reduce(
    (total, tool) => total + tool.trials.length,
    0,
  );
  const dirty = useRef(false);
  const refreshSequence = useRef(0);
  const busy = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const editing = () =>
    viewRef.current.page === "tool-form" ||
    viewRef.current.page === "trial-form";

  async function refresh() {
    const sequence = ++refreshSequence.current;
    if (dirty.current || busy.current || editing()) return;
    try {
      const latest = await repository.load();
      if (
        sequence !== refreshSequence.current ||
        dirty.current ||
        busy.current ||
        editing()
      )
        return;
      if (latest.error) throw new Error(latest.error);
      setSnapshot(latest);
      setSaveError("");
    } catch {
      if (sequence === refreshSequence.current)
        setSaveError("无法刷新云端记录；当前内容不是最新数据，请联网后重试。");
    }
  }

  useEffect(() => {
    if (!cloud) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      ++refreshSequence.current;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [repository, cloud]);

  useEffect(() => {
    heading.current?.focus();
    window.scrollTo?.(0, 0);
  }, [view]);
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (!cloud && (event.key === STORAGE_KEY || event.key === null))
        setMessage({
          text: "另一页面已更新数据。请保留未保存内容，刷新后查看最新记录。",
          kind: "refresh",
        });
    }
    function onUnload(event: BeforeUnloadEvent) {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [cloud]);

  function navigate(next: View) {
    if (saving) return;
    if (dirty.current && !window.confirm("有尚未保存的内容，确定离开吗？"))
      return;
    dirty.current = false;
    ++refreshSequence.current;
    viewRef.current = next;
    setSaveError("");
    setMessage((notice) => (notice?.kind === "refresh" ? notice : null));
    setView(next);
    setMobileMenu(false);
    if (cloud && next.page === "library") void refresh();
  }
  async function commit(next: Tool[], destination: View, success: string) {
    if (saving) return;
    if (snapshot.error) {
      setSaveError(snapshot.error);
      return;
    }
    setSaving(true);
    busy.current = true;
    ++refreshSequence.current;
    setMessage((notice) => (notice?.kind === "refresh" ? notice : null));
    try {
      const raw = await repository.save(next, snapshot.raw);
      setSnapshot({ tools: next, raw, error: null });
      dirty.current = false;
      setSaveError("");
      setView(destination);
      setMessage({ text: success, kind: "success" });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "保存失败，请重试。",
      );
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }
  async function exportData() {
    let latest: Snapshot;
    try {
      latest = await repository.load();
    } catch {
      setSaveError("无法读取云端最新数据，未生成过期备份。请联网后重试。");
      return;
    }
    if (latest.error) {
      setSaveError(latest.error);
      return;
    }
    try {
      const blob = new Blob(
        [JSON.stringify({ version: 1, tools: latest.tools }, null, 2)],
        {
          type: "application/json",
        },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `toollog-${today()}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({
        text: cloud
          ? "已生成云端最新记录的 JSON 备份，请妥善保存。"
          : latest.raw === snapshot.raw
            ? "备份已生成，请妥善保存下载的 JSON 文件。"
            : "已备份本机最新数据。另一页面有更新，请刷新列表后再编辑。",
        kind: cloud || latest.raw === snapshot.raw ? "success" : "refresh",
      });
    } catch {
      setSaveError("无法生成备份，请检查浏览器下载权限后重试。");
    }
  }

  const selected =
    view.page === "detail" || view.page === "tool-form"
      ? tools.find((tool) => tool.id === view.id)
      : view.page === "trial-form"
        ? tools.find((tool) => tool.id === view.toolId)
        : undefined;
  const visible = tools
    .filter(
      (tool) =>
        (filter === "全部工具" || tool.status === filter) &&
        (category === "全部分类" || tool.category === category) &&
        `${tool.name} ${tool.description} ${tool.category}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${mobileMenu ? "is-open" : ""}`}
        aria-label="主导航"
      >
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate({ page: "library" });
          }}
        >
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <span>
            toollog<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">T</span>
          <span>
            <strong>我的工作空间</strong>
            <small>给好工具留个位置</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <span className="nav-caption">工作空间</span>
        <button
          className="nav-item active"
          onClick={() => navigate({ page: "library" })}
        >
          <Grid2X2 size={18} />
          <span>工具库</span>
          <span className="nav-count">{tools.length}</span>
        </button>
        <div className="sidebar-note">
          <Sparkles size={18} />
          <p>
            少一点收藏，
            <br />
            多一点真正的使用。
          </p>
          <span>发现 → 试用 → 留下</span>
        </div>
        <div className="sidebar-bottom">
          <span>
            <HardDrive size={16} />{" "}
            {cloud ? "管理员云端工作空间" : "仅保存在本机"}
          </span>
          <small>你的工具，你的使用手记。</small>
          <span className="version">TOOLLOG / MVP 0.1</span>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="menu-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </button>
            <FolderOpen size={17} />
            <span>工作空间</span>
            <span className="slash">/</span>
            <strong>工具库</strong>
          </div>
          <span className="local-indicator">
            <span />
            {cloud ? "私密云端工作空间" : "本机工作空间"}
          </span>
          {onSignOut && (
            <button
              className="text-button"
              disabled={saving}
              onClick={async () => {
                if (
                  dirty.current &&
                  !window.confirm(
                    "有未保存内容，退出后将丢失草稿，确定退出吗？",
                  )
                )
                  return;
                try {
                  await onSignOut();
                } catch {
                  setSaveError("退出失败，请重试；当前会话仍保持登录。");
                }
              }}
            >
              退出登录
            </button>
          )}
        </header>
        <main>
          {message && (
            <div className="toast" role="status">
              <Check size={17} />
              <span>{message.text}</span>
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => setMessage(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {snapshot.error && (
            <div className="error-banner" role="alert">
              {snapshot.error}
            </div>
          )}
          {view.page !== "tool-form" &&
            view.page !== "trial-form" &&
            saveError && (
              <div className="error-banner" role="alert">
                {saveError}
              </div>
            )}
          {view.page === "library" && (
            <>
              {libraryExtra?.(() => void refresh())}
              {cloud && (
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => void refresh()}
                >
                  刷新云端记录
                </button>
              )}
              <div className="page-heading">
                <div>
                  <p className="eyebrow">YOUR PERSONAL TOOLKIT</p>
                  <h1 ref={heading} tabIndex={-1}>
                    工具库<span className="heading-dot">.</span>
                  </h1>
                  <p className="subtitle">发现好工具，记录每一次真实体验。</p>
                </div>
                <button
                  className="button primary"
                  disabled={!!snapshot.error || saving}
                  onClick={() => navigate({ page: "tool-form" })}
                >
                  <Plus size={18} />
                  添加工具
                </button>
              </div>
              <div className="stats-grid">
                <div className="stat">
                  <span className="stat-icon blue">
                    <Layers size={20} />
                  </span>
                  <div>
                    <span>收录工具</span>
                    <strong>
                      {String(tools.length).padStart(2, "0")}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="stat-caption">慢慢积累你的工具箱</span>
                </div>
                <div className="stat">
                  <span className="stat-icon orange">
                    <FlaskConical size={20} />
                  </span>
                  <div>
                    <span>正在试用</span>
                    <strong>
                      {String(
                        tools.filter((tool) => tool.status === "试用中").length,
                      ).padStart(2, "0")}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="stat-caption">好不好用，试过才知道</span>
                </div>
                <div className="stat">
                  <span className="stat-icon green">
                    <CheckCheck size={20} />
                  </span>
                  <div>
                    <span>试用手记</span>
                    <strong>
                      {String(trialsCount).padStart(2, "0")}
                      <small>篇</small>
                    </strong>
                  </div>
                  <span className="stat-caption">把体验变成自己的经验</span>
                </div>
              </div>
              <section aria-label="工具列表" className="library-section">
                <div className="section-heading">
                  <h2>
                    我的工具<span>{tools.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    disabled={!tools.length || !!snapshot.error}
                    onClick={exportData}
                  >
                    <ArrowDownToLine size={15} />
                    导出备份
                  </button>
                </div>
                <div className="toolbar">
                  <div className="search-wrap">
                    <Search size={18} />
                    <input
                      aria-label="搜索工具"
                      placeholder="搜索工具名称、介绍…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <button
                        aria-label="清空搜索"
                        className="icon-button"
                        onClick={() => setQuery("")}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <div className="select-wrap">
                    <SlidersHorizontal size={16} />
                    <select
                      aria-label="分类筛选"
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                    >
                      <option>全部分类</option>
                      {categories.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="filter-row" aria-label="状态筛选">
                  {["全部工具", ...statuses].map((value) => (
                    <button
                      key={value}
                      aria-pressed={filter === value}
                      className={`filter ${filter === value ? "selected" : ""}`}
                      onClick={() => setFilter(value)}
                    >
                      {value}
                      <span>
                        {value === "全部工具"
                          ? tools.length
                          : tools.filter((tool) => tool.status === value)
                              .length}
                      </span>
                    </button>
                  ))}
                </div>
                {visible.length ? (
                  <div className="tool-grid">
                    {visible.map((tool) => (
                      <button
                        className="tool-card"
                        key={tool.id}
                        onClick={() =>
                          navigate({ page: "detail", id: tool.id })
                        }
                      >
                        <span className="card-top">
                          <ToolIcon tool={tool} />
                          <StatusPill status={tool.status} />
                        </span>
                        <span className="card-title">
                          {tool.name}
                          <ArrowUpRight size={17} />
                        </span>
                        <span className="card-description">
                          {tool.description ||
                            "还没有介绍，写下你想使用它的理由吧。"}
                        </span>
                        <span className="category-label">{tool.category}</span>
                        <span className="card-footer">
                          <span>
                            <BookOpen size={14} />
                            {tool.trials.length} 篇手记
                          </span>
                          <span>{dateLabel(tool.updatedAt)} 更新</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <BookOpen size={32} />
                    </span>
                    <h3>
                      {tools.length
                        ? "没有找到匹配的工具"
                        : "你的工具箱，从这里开始"}
                    </h3>
                    <p>
                      {tools.length
                        ? "换个关键词，或调整分类和状态试试。"
                        : "记下一个想试的工具，留住下一次好用的体验。"}
                    </p>
                    {tools.length ? (
                      <button
                        className="button secondary"
                        onClick={() => {
                          setQuery("");
                          setFilter("全部工具");
                          setCategory("全部分类");
                        }}
                      >
                        清除筛选
                      </button>
                    ) : (
                      <div className="empty-actions">
                        <button
                          className="button primary"
                          disabled={!!snapshot.error || saving}
                          onClick={() => navigate({ page: "tool-form" })}
                        >
                          <Plus size={17} />
                          添加第一个工具
                        </button>
                        <button
                          className="button secondary"
                          disabled={!!snapshot.error || saving}
                          onClick={() =>
                            commit(
                              structuredClone(demoTools),
                              { page: "library" },
                              "已载入 6 个合成示例；示例手记不代表真实测评。",
                            )
                          }
                        >
                          先看看示例
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {!!tools.length && (
                  <p className="list-end">
                    <span />
                    {visible.length
                      ? `已展示 ${visible.length} 个工具 · 好工具不在多，在于适合你`
                      : "试着给筛选松松绑"}
                    <span />
                  </p>
                )}
              </section>
              <div className="local-note">
                <HardDrive size={17} />
                <p>
                  {cloud ? "这是你的私密云端工具库" : "这是你的本机工具库"}
                  <span>
                    {cloud
                      ? "手机与电脑登录同一管理员账号后可访问；刷新或切回页面获取更新。免费项目可能闲置暂停，请定期导出备份。"
                      : "记录仅保存在当前浏览器，清除浏览器数据会丢失；建议定期导出备份。"}
                  </span>
                </p>
                <span className="note-label">
                  {cloud ? "PRIVATE CLOUD" : "LOCAL FIRST"}
                </span>
              </div>
            </>
          )}
          {view.page === "detail" && selected && (
            <>
              <button
                className="back-link"
                onClick={() => navigate({ page: "library" })}
              >
                <ArrowLeft size={17} />
                返回工具库
              </button>
              <section className="detail-panel">
                <div className="detail-top">
                  <ToolIcon tool={selected} large />
                  <button
                    className="button secondary"
                    disabled={!!snapshot.error}
                    onClick={() =>
                      navigate({ page: "tool-form", id: selected.id })
                    }
                  >
                    <Pencil size={16} />
                    编辑工具
                  </button>
                </div>
                <div className="detail-title">
                  <h1 ref={heading} tabIndex={-1}>
                    {selected.name}
                  </h1>
                  <StatusPill status={selected.status} />
                </div>
                <p className="detail-description">
                  {selected.description || "还没有介绍。"}
                </p>
                <div className="detail-meta">
                  <span className="category-label">{selected.category}</span>
                  <span>更新于 {dateLabel(selected.updatedAt)}</span>
                  {selected.url && (
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      访问官网
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                <dl className="tool-facts" aria-label="额度与订阅信息">
                  <div>
                    <dt>免费额度</dt>
                    <dd>{selected.freeQuota?.trim() ? selected.freeQuota : "未记录"}</dd>
                  </div>
                  <div>
                    <dt>是否需要绑卡</dt>
                    <dd>
                      {selected.cardRequired === null
                        ? "未记录"
                        : selected.cardRequired
                          ? "需要绑卡"
                          : "无需绑卡"}
                    </dd>
                  </div>
                  <div>
                    <dt>费用</dt>
                    <dd>{selected.cost?.trim() ? selected.cost : "未记录"}</dd>
                  </div>
                  <div>
                    <dt>到期日</dt>
                    <dd>
                      {selected.expiresOn
                        ? dateLabel(selected.expiresOn)
                        : "未记录"}
                    </dd>
                  </div>
                  <div>
                    <dt>评分</dt>
                    <dd>
                      {selected.rating === null
                        ? "未记录"
                        : `${selected.rating} / 5`}
                    </dd>
                  </div>
                </dl>
              </section>
              <div className="section-heading trial-heading">
                <div>
                  <h2>
                    试用手记<span>{selected.trials.length}</span>
                  </h2>
                  <p>记录场景、感受，也记录不适合的理由。</p>
                </div>
                <button
                  className="button primary"
                  disabled={!!snapshot.error}
                  onClick={() =>
                    navigate({ page: "trial-form", toolId: selected.id })
                  }
                >
                  <Plus size={17} />
                  写手记
                </button>
              </div>
              {selected.trials.length ? (
                <div className="trial-list">
                  {[...selected.trials]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((trial) => (
                      <article className="trial-card" key={trial.id}>
                        <div className="trial-top">
                          <span className="trial-date">
                            <Clock3 size={15} />
                            {dateLabel(trial.date)}
                          </span>
                          <span className="verdict">{trial.verdict}</span>
                          <button
                            className="icon-button"
                            aria-label={`编辑 ${trial.date} 手记`}
                            onClick={() =>
                              navigate({
                                page: "trial-form",
                                toolId: selected.id,
                                trialId: trial.id,
                              })
                            }
                          >
                            <Pencil size={17} />
                          </button>
                        </div>
                        {trial.environment && (
                          <p className="trial-environment">
                            使用环境 · {trial.environment}
                          </p>
                        )}
                        <p className="trial-notes">{trial.notes}</p>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="empty-state compact">
                  <FlaskConical size={30} />
                  <h3>第一次体验，值得记录</h3>
                  <p>试着用它完成一件小事，然后写下感受。</p>
                </div>
              )}
            </>
          )}
          {view.page === "tool-form" && (
            <ToolForm
              key={view.id ?? "new"}
              cloud={cloud}
              tool={selected}
              error={saveError}
              disabled={!!snapshot.error || saving}
              headingRef={heading}
              onDirty={() => {
                dirty.current = true;
              }}
              onCancel={() =>
                navigate(
                  selected
                    ? { page: "detail", id: selected.id }
                    : { page: "library" },
                )
              }
              onSave={(input) => {
                const error = validateTool(input);
                if (error) {
                  setSaveError(error);
                  return;
                }
                const tool: Tool = {
                  ...input,
                  id: selected?.id ?? createId(),
                  updatedAt: new Date().toISOString(),
                  trials: selected?.trials ?? [],
                };
                commit(
                  selected
                    ? tools.map((item) => (item.id === tool.id ? tool : item))
                    : [tool, ...tools],
                  { page: "detail", id: tool.id },
                  selected
                    ? cloud
                      ? "工具修改已保存到云端。"
                      : "工具修改已保存到本机。"
                    : cloud
                      ? "工具已添加并保存到云端。"
                      : "工具已添加并保存到本机。",
                );
              }}
            />
          )}
          {view.page === "trial-form" && selected && (
            <TrialForm
              key={view.trialId ?? "new"}
              cloud={cloud}
              tool={selected}
              trial={selected.trials.find((trial) => trial.id === view.trialId)}
              error={saveError}
              disabled={!!snapshot.error || saving}
              headingRef={heading}
              onDirty={() => {
                dirty.current = true;
              }}
              onCancel={() => navigate({ page: "detail", id: selected.id })}
              onSave={(input) => {
                const error = validateTrial(input);
                if (error) {
                  setSaveError(error);
                  return;
                }
                const trial: Trial = {
                  ...input,
                  id: view.trialId ?? createId(),
                };
                const updated = {
                  ...selected,
                  updatedAt: new Date().toISOString(),
                  trials: view.trialId
                    ? selected.trials.map((item) =>
                        item.id === trial.id ? trial : item,
                      )
                    : [trial, ...selected.trials],
                };
                commit(
                  tools.map((tool) =>
                    tool.id === selected.id ? updated : tool,
                  ),
                  { page: "detail", id: selected.id },
                  cloud ? "试用手记已保存到云端。" : "试用手记已保存到本机。",
                );
              }}
            />
          )}
          <footer className="page-footer">
            <span>
              toollog<span className="brand-dot">.</span>{" "}
              <span className="footer-tagline">让工具服务于你。</span>
            </span>
            <span>用心试用，认真记录。</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

type FormProps = {
  cloud: boolean;
  error: string;
  disabled: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onDirty: () => void;
  onCancel: () => void;
};
function ToolForm({
  cloud,
  tool,
  error,
  disabled,
  headingRef,
  onDirty,
  onCancel,
  onSave,
}: FormProps & { tool?: Tool; onSave: (input: ToolInput) => void }) {
  const [input, setInput] = useState<ToolInput>(
    tool
      ? {
          name: tool.name,
          description: tool.description,
          url: tool.url,
          category: tool.category,
          status: tool.status,
          freeQuota: tool.freeQuota,
          cardRequired: tool.cardRequired,
          cost: tool.cost,
          expiresOn: tool.expiresOn,
          rating: tool.rating,
        }
      : emptyTool,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...input,
      name: input.name.trim(),
      description: input.description.trim(),
      url: input.url.trim(),
    });
  }
  return (
    <div className="form-container">
      <button className="back-link" onClick={onCancel}>
        <ArrowLeft size={17} />
        取消并返回
      </button>
      <p className="eyebrow">BUILD YOUR TOOLKIT</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {tool ? "编辑工具" : "添加一个好工具"}
      </h1>
      <p className="subtitle">从一个名字开始，慢慢记录它的可能性。</p>
      <form
        className="editor"
        inert={disabled}
        aria-busy={disabled}
        onSubmit={submit}
        onChange={onDirty}
      >
        <Field label="工具名称 *">
          <input
            required
            maxLength={80}
            value={input.name}
            placeholder="例如：Notion"
            onChange={(event) =>
              setInput({ ...input, name: event.target.value })
            }
          />
        </Field>
        <Field label="一句话介绍" hint="它能帮你解决什么问题？">
          <textarea
            maxLength={500}
            rows={3}
            value={input.description}
            placeholder="写下它的用途，或你想试试它的理由…"
            onChange={(event) =>
              setInput({ ...input, description: event.target.value })
            }
          />
        </Field>
        <Field
          label="工具网址"
          hint="可选，使用完整的 http:// 或 https:// 链接。"
        >
          <input
            type="url"
            maxLength={2048}
            value={input.url}
            placeholder="https://"
            onChange={(event) =>
              setInput({ ...input, url: event.target.value })
            }
          />
        </Field>
        <div className="form-row">
          <Field label="分类">
            <select
              value={input.category}
              onChange={(event) =>
                setInput({
                  ...input,
                  category: event.target.value as Tool["category"],
                })
              }
            >
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="使用状态">
            <select
              value={input.status}
              onChange={(event) =>
                setInput({
                  ...input,
                  status: event.target.value as Tool["status"],
                })
              }
            >
              {statuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="metadata-fields">
          <h2>额度与订阅信息</h2>
          <p>按你掌握的信息手动记录；留空表示尚未记录。</p>
          <div className="form-row">
            <Field label="免费额度" hint="例如：每月 100 次；最多 200 字。">
              <input
                maxLength={200}
                value={input.freeQuota ?? ""}
                placeholder="未记录"
                onChange={(event) =>
                  setInput({
                    ...input,
                    freeQuota: event.target.value || null,
                  })
                }
              />
            </Field>
            <Field label="是否需要绑卡">
              <select
                value={input.cardRequired === null ? "" : String(input.cardRequired)}
                onChange={(event) =>
                  setInput({
                    ...input,
                    cardRequired:
                      event.target.value === ""
                        ? null
                        : event.target.value === "true",
                  })
                }
              >
                <option value="">未记录</option>
                <option value="true">需要绑卡</option>
                <option value="false">无需绑卡</option>
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="费用" hint="可记录币种与计费周期；最多 200 字。">
              <input
                maxLength={200}
                value={input.cost ?? ""}
                placeholder="未记录"
                onChange={(event) =>
                  setInput({ ...input, cost: event.target.value || null })
                }
              />
            </Field>
            <Field label="到期日">
              <input
                type="date"
                value={input.expiresOn ?? ""}
                onChange={(event) =>
                  setInput({ ...input, expiresOn: event.target.value || null })
                }
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label="评分（1–5）">
              <select
                value={input.rating === null ? "" : String(input.rating)}
                onChange={(event) =>
                  setInput({
                    ...input,
                    rating:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">未评分</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value} / 5
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <div className="form-actions">
          <span>
            {cloud ? <Cloud size={14} /> : <HardDrive size={14} />}
            {cloud ? "保存到私密云端" : "仅保存到当前浏览器"}
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={disabled}
            >
              <Check size={17} />
              保存工具
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function TrialForm({
  cloud,
  tool,
  trial,
  error,
  disabled,
  headingRef,
  onDirty,
  onCancel,
  onSave,
}: FormProps & {
  tool: Tool;
  trial?: Trial;
  onSave: (input: Omit<Trial, "id">) => void;
}) {
  const [input, setInput] = useState<Omit<Trial, "id">>(
    trial ?? { date: today(), environment: "", verdict: "继续观察", notes: "" },
  );
  return (
    <div className="form-container">
      <button className="back-link" onClick={onCancel}>
        <ArrowLeft size={17} />
        返回 {tool.name}
      </button>
      <p className="eyebrow">A LITTLE EXPERIENCE, A USEFUL NOTE</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {trial ? "编辑试用手记" : "写一篇试用手记"}
      </h1>
      <p className="subtitle">关于 {tool.name}，这次有什么新发现？</p>
      <form
        className="editor"
        inert={disabled}
        aria-busy={disabled}
        onChange={onDirty}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(input);
        }}
      >
        <div className="form-row">
          <Field label="试用日期 *">
            <input
              required
              type="date"
              value={input.date}
              onChange={(event) =>
                setInput({ ...input, date: event.target.value })
              }
            />
          </Field>
          <Field label="试用结论">
            <select
              value={input.verdict}
              onChange={(event) =>
                setInput({
                  ...input,
                  verdict: event.target.value as Trial["verdict"],
                })
              }
            >
              {verdicts.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="使用环境" hint="可选，记录设备、系统或具体场景。">
          <input
            maxLength={100}
            value={input.environment}
            placeholder="例如：手机浏览器 / 整理周计划"
            onChange={(event) =>
              setInput({ ...input, environment: event.target.value })
            }
          />
        </Field>
        <Field label="试用笔记 *" hint="不需要长篇大论，真实感受就很好。">
          <textarea
            required
            maxLength={5000}
            rows={8}
            value={input.notes}
            placeholder="用它做了什么？哪里顺手，哪里不适合？下次还会用吗？"
            onChange={(event) =>
              setInput({ ...input, notes: event.target.value })
            }
          />
        </Field>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <div className="form-actions">
          <span>
            {cloud ? <Cloud size={14} /> : <HardDrive size={14} />}
            {cloud ? "保存到私密云端" : "仅保存到当前浏览器"}
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={disabled}
            >
              <Check size={17} />
              保存手记
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
