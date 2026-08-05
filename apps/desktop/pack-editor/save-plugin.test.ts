import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPack } from "../src/domain/formModel";
import { makePlanPack } from "../src/domain/testing/fixtures";

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock("node:fs", () => ({ ...fsMocks, default: fsMocks }));

import { packEditorSavePlugin } from "./save-plugin";

function handler() {
  let middleware: ((request: EventEmitter & { method: string; url: string; headers: Record<string, string> }, response: TestResponse, next: () => void) => void) | undefined;
  const server = { middlewares: { use: (_path: string, callback: typeof middleware) => { middleware = callback; } } };
  const configure = packEditorSavePlugin().configureServer!;
  if (typeof configure === "function") configure.call({} as never, server as never);
  else configure.handler.call({} as never, server as never);
  return middleware!;
}

interface TestResponse {
  statusCode: number;
  body?: string;
  setHeader: (key: string, value: string) => void;
  end: (body: string) => void;
}

function response(): TestResponse {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end(body) { this.body = body; },
  };
}

async function post(
  body: unknown,
  options: { url?: string; headers?: Record<string, string> } = {},
) {
  const request = Object.assign(new EventEmitter(), {
    method: "POST",
    url: options.url ?? "/",
    headers: {
      host: "localhost:1430",
      origin: "http://localhost:1430",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...options.headers,
    },
  });
  const result = response();
  handler()(request, result, () => undefined);
  request.emit("data", Buffer.from(JSON.stringify(body)));
  request.emit("end");
  await Promise.resolve();
  return result;
}

describe("pack editor save boundary", () => {
  let current: FormPack;
  beforeEach(() => {
    vi.clearAllMocks();
    current = makePlanPack();
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(current));
  });

  it("backs up then atomically renames a validated pack", async () => {
    const edited = structuredClone(current);
    edited.sections[0].title = "My plan";
    const result = await post({ pack: edited, previousPack: current });

    expect(result.statusCode).toBe(200);
    expect(fsMocks.copyFileSync).toHaveBeenCalledTimes(1);
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/default-pack\.json\.tmp-/),
      `${JSON.stringify(edited, null, 2)}\n`,
      { flag: "wx" },
    );
    expect(fsMocks.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/default-pack\.json\.tmp-/),
      expect.stringMatching(/default-pack\.json$/),
    );
  });

  it("refuses a stale editor baseline without writing or backing up", async () => {
    const stale = structuredClone(current);
    stale.packVersion = "0.9.0";
    const result = await post({ pack: current, previousPack: stale });

    expect(result.statusCode).toBe(409);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(fsMocks.copyFileSync).not.toHaveBeenCalled();
  });

  it("rejects invalid posted packs at the server boundary", async () => {
    const result = await post({ pack: { packId: "broken" }, previousPack: current });

    expect(result.statusCode).toBe(400);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects cross-site mutations without touching the pack", async () => {
    const result = await post({}, {
      url: "/backup",
      headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" },
    });

    expect(result.statusCode).toBe(403);
    expect(fsMocks.copyFileSync).not.toHaveBeenCalled();
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("requires JSON for save requests", async () => {
    const result = await post({}, { headers: { "content-type": "text/plain" } });

    expect(result.statusCode).toBe(415);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });
});
