import type { Tool } from "./model";
import { loadTools, saveTools, type Snapshot } from "./storage";

export interface Repository {
  kind: "local" | "cloud";
  load(): Snapshot | Promise<Snapshot>;
  save(tools: Tool[], revision: string | null): Promise<string>;
}

export const localRepository: Repository = {
  kind: "local",
  load: loadTools,
  save: saveTools,
};
