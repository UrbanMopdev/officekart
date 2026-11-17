import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { sleep } from "./bot";

export interface TestServer {
  url: string;
  httpUrl: string;
  child?: ChildProcess;
  stop(): Promise<void>;
}

/**
 * Use SERVER_URL if given (e.g. the deployed Railway server), otherwise start
 * the built server locally on a spare port.
 */
export async function getServer(port = 2599): Promise<TestServer> {
  const external = process.env.SERVER_URL;
  if (external) {
    const url = external.replace(/\/+$/, "");
    return { url, httpUrl: url.replace(/^ws/, "http"), stop: async () => {} };
  }
  const entry = path.resolve(__dirname, "../dist/server.js");
  if (!existsSync(entry)) throw new Error("Build the server first: npm run build -w @office-kart/game-server");
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "test", MATCHMAKE_PER_MINUTE: "100000" },
    stdio: ["ignore", process.env.SERVER_LOGS ? "inherit" : "ignore", "inherit"],
  });
  const httpUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${httpUrl}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  return {
    url: `ws://127.0.0.1:${port}`,
    httpUrl,
    child,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((r) => child.once("exit", () => r()));
    },
  };
}
