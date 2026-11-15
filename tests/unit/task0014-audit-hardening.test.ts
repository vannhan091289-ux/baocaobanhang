import { describe, expect, it, vi } from "vitest";
import nextConfig, {
  buildCspHeader,
  buildSecurityHeaders,
} from "../../next.config";
import {
  isJsonContentType,
  MAX_JSON_BODY_BYTES,
  readBoundedJsonBodyText,
} from "@/server/body-reader";
import { parseEnvFileContent } from "@/server/config";

describe("TASK-0014 A-03: Bounded streaming body reader & Content-Type", () => {
  it("reads JSON body within 16 KB limit", async () => {
    const payload = JSON.stringify({ ok: true, msg: "hello" });
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(await readBoundedJsonBodyText(req)).toEqual({
      ok: true,
      text: payload,
    });
  });

  it("allows empty body even without Content-Type", async () => {
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
    });
    expect(await readBoundedJsonBodyText(req)).toEqual({ ok: true, text: "" });
  });

  it("counts multi-byte UTF-8 characters by bytes, not string length", async () => {
    // 'ă' is 2 bytes in UTF-8: 9000 chars (< 16384 chars) = 18000 bytes (> 16384 bytes)
    const multiByteOver = JSON.stringify({ text: "ă".repeat(9000) });
    expect(multiByteOver.length).toBeLessThan(MAX_JSON_BODY_BYTES);
    expect(Buffer.byteLength(multiByteOver, "utf8")).toBeGreaterThan(
      MAX_JSON_BODY_BYTES,
    );

    const overReq = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: multiByteOver,
    });
    expect(await readBoundedJsonBodyText(overReq)).toEqual({
      ok: false,
      reason: "TOO_LARGE",
    });

    // 6000 'ă' chars = ~12012 bytes <= 16384 bytes
    const multiByteOk = JSON.stringify({ text: "ă".repeat(6000) });
    const okReq = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: multiByteOk,
    });
    expect(await readBoundedJsonBodyText(okReq)).toEqual({
      ok: true,
      text: multiByteOk,
    });
  });

  it("rejects early when Content-Length exceeds 16 KB without reading stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_JSON_BODY_BYTES + 1),
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const getReaderSpy = vi.spyOn(req.body!, "getReader");
    expect(await readBoundedJsonBodyText(req)).toEqual({
      ok: false,
      reason: "TOO_LARGE",
    });
    expect(getReaderSpy).not.toHaveBeenCalled();
  });

  it("cancels stream immediately when chunked body exceeds 16 KB without Content-Length", async () => {
    let canceled = false;
    const chunk = new Uint8Array(8 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    });
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(await readBoundedJsonBodyText(req)).toEqual({
      ok: false,
      reason: "TOO_LARGE",
    });
    expect(canceled).toBe(true);
  });

  it("recognizes application/json case-insensitively with charset and rejects non-JSON non-empty bodies", async () => {
    expect(isJsonContentType("APPLICATION/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);

    const jsonCharsetReq = new Request(
      "http://127.0.0.1:3100/api/planning/plans",
      {
        method: "POST",
        headers: { "content-type": "APPLICATION/JSON; charset=utf-8" },
        body: '{"ok":true}',
      },
    );
    expect(await readBoundedJsonBodyText(jsonCharsetReq)).toEqual({
      ok: true,
      text: '{"ok":true}',
    });

    const textReq = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: '{"ok":true}',
    });
    expect(await readBoundedJsonBodyText(textReq)).toEqual({
      ok: false,
      reason: "UNSUPPORTED_MEDIA_TYPE",
    });
  });
});

describe("TASK-0014 A-02: Security headers & CSP config", () => {
  it("configures all 7 security headers and disables poweredByHeader", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");

    const prodHeaders = buildSecurityHeaders(false);
    const map = Object.fromEntries(prodHeaders.map((h) => [h.key, h.value]));
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["X-Frame-Options"]).toBe("DENY");
    expect(map["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(map["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(map["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(map["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(map["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(map["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(map["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(map["Content-Security-Policy"]).not.toContain("'unsafe-eval'");

    expect(buildCspHeader(true)).toContain("'unsafe-eval'");
  });
});

describe("TASK-0014 A-06: Pure .env parser", () => {
  it("strips matching quotes, handles export, CRLF, equals in values, and skips invalid lines", () => {
    const raw = [
      "# comment line",
      "",
      'DOUBLE="hello world"',
      "SINGLE='single val'",
      "UNBALANCED=\"mismatch'",
      'NESTED="\'"inner"\'"',
      "export EXPORTED='exported_val'",
      "WITH_EQUALS=abc=def=123",
      'NO_EXPAND="$OTHER_VAR"',
      "NO_EQUALS_LINE",
      "123INVALID=bad",
      "BAD-KEY=bad",
    ].join("\r\n");

    expect(parseEnvFileContent(raw)).toEqual({
      DOUBLE: "hello world",
      SINGLE: "single val",
      UNBALANCED: "\"mismatch'",
      NESTED: "'\"inner\"'",
      EXPORTED: "exported_val",
      WITH_EQUALS: "abc=def=123",
      NO_EXPAND: "$OTHER_VAR",
    });
  });
});
