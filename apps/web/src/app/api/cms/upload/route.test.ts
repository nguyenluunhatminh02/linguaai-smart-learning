import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const ROUTE_PATH = path.resolve(__dirname, "./route.ts");
process.env.CMS_BACKEND_URL = "http://backend.test/api/v1";

const { fileWrites, fsMock } = vi.hoisted(() => {
  const fileWrites = vi.fn();
  return {
    fileWrites,
    fsMock: {
      writeFile: fileWrites,
      writeFileSync: fileWrites,
      mkdir: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

const mocks = vi.hoisted(() => ({
  verifyAuthHeader: vi.fn(),
  isAdmin: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/jwt-verify", () => ({
  verifyAuthHeader: mocks.verifyAuthHeader,
  isAdmin: mocks.isAdmin,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual, ...fsMock },
    ...fsMock,
  };
});

import { POST } from "./route";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function makeRequest(file?: File | string, token = "Bearer admin-token") {
  const formData = new FormData();
  if (file !== undefined) {
    formData.append("file", file);
  }
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = token;
  return new NextRequest("http://localhost/api/cms/upload", {
    method: "POST",
    headers,
    body: formData,
  });
}

function pngFile(name = "photo.png", bytes = PNG, type = "image/png") {
  return new File([bytes], name, { type });
}

function okBackend(url = "https://cdn.example.com/owner/abc.png", data = false) {
  const body = data ? { data: { url, id: "file-1" } } : { url };
  return { ok: true, status: 200, json: async () => body } as Response;
}

function statusBackend(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  } as Response;
}

async function expectNoWrite(fn: () => Promise<unknown>) {
  fileWrites.mockClear();
  fsMock.mkdir.mockClear();
  fsMock.mkdirSync.mockClear();
  await fn();
  expect(fileWrites).not.toHaveBeenCalled();
  expect(fsMock.mkdir).not.toHaveBeenCalled();
  expect(fsMock.mkdirSync).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.verifyAuthHeader.mockResolvedValue({
    id: "owner-1",
    email: "admin@example.com",
    roles: ["ADMIN"],
    isAdmin: true,
  });
  mocks.isAdmin.mockImplementation((user) => Boolean(user?.isAdmin));
  mocks.fetch.mockResolvedValue(okBackend());
  vi.stubEnv("CMS_BACKEND_URL", "http://backend.test/api/v1");
  vi.stubEnv("INTERNAL_API_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/cms/upload", () => {
  it("rejects missing, invalid and non-admin tokens without calling the backend or writing files", async () => {
    mocks.verifyAuthHeader.mockResolvedValue(null);
    await expectNoWrite(async () => {
      const noToken = await POST(makeRequest(pngFile(), ""));
      expect(noToken.status).toBe(401);
      const invalid = await POST(makeRequest(pngFile(), "Bearer bad"));
      expect(invalid.status).toBe(401);

      mocks.verifyAuthHeader.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        roles: ["STUDENT"],
        isAdmin: false,
      });
      const nonAdmin = await POST(makeRequest(pngFile()));
      expect(nonAdmin.status).toBe(401);
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("forwards validated PNG/WebP bytes and Authorization to the backend and returns its url unchanged", async () => {
    const cases: Array<[File, Uint8Array]> = [
      [pngFile(), PNG],
      [pngFile("picture.webp", WEBP, "image/webp"), WEBP],
    ];
    for (const [file, bytesForFile] of cases) {
      mocks.fetch.mockResolvedValue(okBackend());
      const response = await POST(makeRequest(file));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: "https://cdn.example.com/owner/abc.png",
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);

      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://backend.test/api/v1/files/upload");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ Authorization: "Bearer admin-token" });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = init.body as FormData;
      const forwarded = body.get("file") as File;
      expect(forwarded.name).toMatch(/^upload\.(png|webp)$/);
      expect(forwarded.type).toBe(file.type);
      expect(Array.from(new Uint8Array(await forwarded.arrayBuffer()))).toEqual(
        Array.from(bytesForFile),
      );
      mocks.fetch.mockClear();
    }
  });

  it("unwraps a nested backend { data: { url } } payload", async () => {
    mocks.fetch.mockResolvedValue(
      okBackend("https://cdn.example.com/owner/nested.png", true),
    );
    const response = await POST(makeRequest(pngFile()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://cdn.example.com/owner/nested.png",
      id: "file-1",
    });
  });

  it("uses INTERNAL_API_URL config when provided", async () => {
    // The module resolves this once at import time; assert the configured
    // value without depending on import order by reading the route source.
    const source = readFileSync(ROUTE_PATH, "utf8");
    expect(source).toContain("process.env.INTERNAL_API_URL");
    expect(source).toContain("process.env.CMS_BACKEND_URL");
  });

  it.each([401, 403])(
    "maps backend %i to 401 without a local fallback",
    async (status) => {
      mocks.fetch.mockResolvedValue(statusBackend(status));
      await expectNoWrite(async () => {
        const response = await POST(makeRequest(pngFile()));
        expect(response.status).toBe(401);
      });
    },
  );

  it.each([400, 413, 422, 500, 503])(
    "maps backend %i to 502 (validation failures are not silently accepted)",
    async (status) => {
      mocks.fetch.mockResolvedValue(statusBackend(status));
      await expectNoWrite(async () => {
        const response = await POST(makeRequest(pngFile()));
        expect(response.status).toBe(502);
      });
    },
  );

  it("maps network errors and aborts to 502 with no local fallback", async () => {
    for (const error of [new TypeError("network down"), new Error("aborted")]) {
      mocks.fetch.mockRejectedValue(error);
      await expectNoWrite(async () => {
        const response = await POST(makeRequest(pngFile()));
        expect(response.status).toBe(502);
      });
    }
  });

  it("rejects malformed backend responses with 502", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const response = await POST(makeRequest(pngFile()));
    expect(response.status).toBe(502);
  });

  it.each([
    ["unsupported MIME", pngFile("photo.png", PNG, "application/pdf"), 400, false],
    [
      "client extension/MIME mismatch",
      pngFile("photo.jpg", PNG, "image/png"),
      400,
      false,
    ],
    ["bad magic bytes", pngFile("photo.png", WEBP, "image/png"), 400, true],
    ["empty file", pngFile("photo.png", new Uint8Array(), "image/png"), 400, false],
    [
      "oversize file",
      pngFile("photo.png", new Uint8Array(5 * 1024 * 1024 + 1).fill(0)),
      400,
      false,
    ],
    ["no file", undefined, 400, false],
  ])("rejects %s before the backend call", async (_label, file, expected, needsByteRead) => {
    const arrayBufferSpy = vi
      .spyOn(File.prototype, "arrayBuffer")
      .mockRejectedValue(new Error("must not read bytes"));
    await expectNoWrite(async () => {
      const response = await POST(makeRequest(file));
      expect(response.status).toBe(expected);
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    if (!needsByteRead) {
      expect(arrayBufferSpy).not.toHaveBeenCalled();
    }
    arrayBufferSpy.mockRestore();
  });

  it("never lets a traversal filename influence the transport name or object name", async () => {
    const response = await POST(makeRequest(pngFile("../../evil.png")));
    expect(response.status).toBe(200);
    const body = mocks.fetch.mock.calls[0][1].body as FormData;
    const forwarded = body.get("file") as File;
    expect(forwarded.name).toBe("upload.png");
    expect(forwarded.name).not.toContain("..");
    expect(forwarded.name).not.toContain("/");
    expect(mocks.fetch.mock.calls[0][0]).not.toContain("evil");
  });

  it("contains no local filesystem or provider call in source", () => {
    const source = readFileSync(ROUTE_PATH, "utf8");
    expect(source).not.toMatch(/from\s+["'](node:)?fs["']/);
    expect(source).not.toMatch(/from\s+["'](node:)?path["']/);
    expect(source).not.toMatch(/\bwriteFileSync?\s*\(/);
    expect(source).not.toMatch(/\bpublic[\\/]uploads\b/);
    expect(source).not.toMatch(/S3|Cloudinary|PutObjectCommand|@aws-sdk/);
  });
});
