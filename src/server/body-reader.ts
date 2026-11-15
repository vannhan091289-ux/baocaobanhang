export const MAX_JSON_BODY_BYTES = 16 * 1024;

export type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" };

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json";
}

export async function readBoundedJsonBodyText(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<BodyReadResult> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, reason: "TOO_LARGE" };
    }
  }

  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          return { ok: false, reason: "TOO_LARGE" };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return { ok: true, text: "" };
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, reason: "UNSUPPORTED_MEDIA_TYPE" };
  }

  return {
    ok: true,
    text: Buffer.concat(chunks, totalBytes).toString("utf8"),
  };
}
