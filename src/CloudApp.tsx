import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import App from "./App";
import { CloudRepository, configuredClient, type CloudSnapshot } from "./cloud";
import MigrationPanel from "./MigrationPanel";

type CloudEnvironment = Record<string, string | undefined>;

function getConfiguration(environment?: CloudEnvironment) {
  try {
    const env =
      environment ??
      (import.meta as ImportMeta & { env: CloudEnvironment }).env;
    return {
      client: configuredClient(
        env.VITE_SUPABASE_URL ?? "",
        env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
      error: "",
    };
  } catch (error) {
    return {
      client: null,
      error: error instanceof Error ? error.message : "云端配置无效。",
    };
  }
}

export default function CloudApp({
  environment,
}: {
  environment?: CloudEnvironment;
} = {}) {
  const [configuration] = useState(() => getConfiguration(environment));
  if (!configuration.client)
    return (
      <div className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">TOOLLOG / PRIVATE PREVIEW</p>
          <h1>云端连接尚未就绪</h1>
          <p role="status">
            {configuration.error ||
              "管理员尚未配置免费项目。当前版本保持锁定，不会自动退回本机保存，也不会读取或上传旧记录。"}
          </p>
          <p>原本机预览和 JSON 备份保持不变。项目就绪后在此登录。</p>
        </section>
      </div>
    );
  return <AuthenticatedApp client={configuration.client} />;
}

export function AuthenticatedApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [initial, setInitial] = useState<CloudSnapshot | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const repository = useMemo(() => new CloudRepository(client), [client]);
  const userId = session?.user.id;
  useEffect(() => {
    let active = true;
    // Callback does no awaited Supabase work: avoids the SDK auth-lock deadlock.
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setSession(next);
        if (!next) setInitial(null);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);
  useEffect(() => {
    let active = true;
    setInitial(null);
    if (!userId) return;
    setError("");
    void repository
      .load()
      .then((snapshot) => {
        if (active) setInitial(snapshot);
      })
      .catch(() => {
        if (active)
          setError(
            "无法打开云端工具库：请确认当前账号是唯一管理员、登录有效且免费项目未暂停。",
          );
      });
    return () => {
      active = false;
    };
  }, [repository, userId, reload]);

  async function signOut() {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    setInitial(null);
    setSession(null);
    setPassword("");
    setEmail("");
    setError("");
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword("");
    } catch {
      setError("登录失败，请检查管理员邮箱和密码，或稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (session && initial)
    return (
      <App
        key={userId}
        repository={repository}
        initial={initial}
        onSignOut={signOut}
        libraryExtra={(onRefresh) => (
          <MigrationPanel repository={repository} onImported={onRefresh} />
        )}
      />
    );

  return (
    <div className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">TOOLLOG / PRIVATE WORKSPACE</p>
        <h1>你的工具与使用手记</h1>
        <p>仅限已授权的唯一管理员。手机与电脑登录同一账号查看同一份记录。</p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {session === undefined ? (
          <p role="status">正在检查登录…</p>
        ) : session ? (
          <>
            {!error && <p role="status">正在安全读取云端记录…</p>}
            {error && (
              <button
                className="button secondary"
                onClick={() => setReload((n) => n + 1)}
              >
                重试连接
              </button>
            )}
            <button
              className="text-button"
              onClick={() =>
                void signOut().catch(() => setError("退出失败，请重试。"))
              }
            >
              退出登录
            </button>
          </>
        ) : (
          <form onSubmit={signIn}>
            <label className="field">
              管理员邮箱
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field">
              密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? "正在登录…" : "登录私密工具库"}
            </button>
            <small>
              不开放注册。账号或密码需要帮助时，请联系此项目管理员。
            </small>
          </form>
        )}
        <small>
          云端记录不会存入本机旧数据区；旧记录须先备份并单独确认导入。
        </small>
      </section>
    </div>
  );
}
