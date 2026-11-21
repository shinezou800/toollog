// Shared by Vite's BUILD guard and runtime; contains no credentials.
export function isPublishableKey(key: string) {
  if (key.startsWith("sb_publishable_") && key.length > 20) return true;
  try {
    const payload = JSON.parse(
      atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload.role === "anon";
  } catch {
    return false;
  }
}
