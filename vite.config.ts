import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { isPublishableKey } from "./src/public-config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // A runtime-only check is too late: Vite would already embed the secret.
  if (key && !isPublishableKey(key))
    throw new Error(
      "Unsafe Supabase key: only a publishable/anon key may enter the browser build.",
    );
  for (const [name, value] of Object.entries(env)) {
    if (
      /service.?role|secret|password/i.test(name) ||
      value.startsWith("sb_secret_")
    )
      throw new Error(
        "A privileged secret was placed in a VITE_ variable. Build refused.",
      );
  }
  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      restoreMocks: true,
    },
  };
});
