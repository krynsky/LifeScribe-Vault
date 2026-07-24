import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", () => ({ ...fsMocks, default: fsMocks }));

const { packEditorSavePlugin } = await import("./save-plugin.mjs");

function getHandler() {
  let handler;
  const server = {
    middlewares: {
      use: (_path, fn) => {
        handler = fn;
      },
    },
  };
  packEditorSavePlugin().configureServer(server);
  return handler;
}

function makeReq(method, url, bodyObj) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  queueMicrotask(() => {
    if (bodyObj !== undefined) {
      req.emit("data", Buffer.from(JSON.stringify(bodyObj)));
    }
    req.emit("end");
  });
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

describe("pack-editor save-plugin POST /__pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.readFileSync.mockReturnValue("{}");
  });

  it("writes the posted pack straight to default-pack.json as 2-space JSON with a trailing newline", async () => {
    const handler = getHandler();
    const pack = { packId: "x", modules: [{ moduleId: "m" }] };
    const req = makeReq("POST", "/", pack);
    const res = makeRes();
    handler(req, res, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, contents] = fsMocks.writeFileSync.mock.calls[0];
    expect(filePath).toMatch(/default-pack\.json$/);
    expect(contents).toBe(`${JSON.stringify(pack, null, 2)}\n`);
    expect(res.statusCode).toBe(200);
  });

  it("does not touch the credential pack or overlay files on save", async () => {
    const handler = getHandler();
    const req = makeReq("POST", "/", { packId: "x" });
    const res = makeRes();
    handler(req, res, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const call of fsMocks.writeFileSync.mock.calls) {
      expect(String(call[0])).not.toMatch(/credential|overlay/i);
    }
    expect(fsMocks.readFileSync).not.toHaveBeenCalledWith(
      expect.stringMatching(/overlay/i),
      expect.anything(),
    );
  });
});
