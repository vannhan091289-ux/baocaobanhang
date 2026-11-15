import { describe, expect, it } from "vitest";
import { readBoundedBodyText } from "@/server/api-guard";
import { stripMatchingQuotes } from "@/server/config";

describe("Audit hardening A-03 & A-06 unit checks", () => {
  it("rejects oversized Content-Length before reading body stream", async () => {
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "999999",
      },
      body: JSON.stringify({ ok: true }),
    });
    const res = await readBoundedBodyText(req, 16 * 1024);
    expect(res.ok).toBe(false);
  });

  it("aborts streaming body that exceeds maxBytes without Content-Length", async () => {
    const huge = "x".repeat(17 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(huge));
        controller.close();
      },
    });
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await readBoundedBodyText(req, 16 * 1024);
    expect(res.ok).toBe(false);
  });

  it("reads valid JSON payload within maxBytes", async () => {
    const payload = JSON.stringify({ hello: "world" });
    const req = new Request("http://127.0.0.1:3100/api/planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    const res = await readBoundedBodyText(req, 16 * 1024);
    expect(res).toEqual({ ok: true, text: payload });
  });

  it("strips matching single or double quotes from env values (A-06)", () => {
    expect(stripMatchingQuotes(' "abc123" ')).toBe("abc123");
    expect(stripMatchingQuotes(" 'xyz789' ")).toBe("xyz789");
    expect(stripMatchingQuotes(" \"mismatch' ")).toBe("\"mismatch'");
    expect(stripMatchingQuotes("plain")).toBe("plain");
  });
});
