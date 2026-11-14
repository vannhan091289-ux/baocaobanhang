import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createProspect,
  listProspects,
  patchProspect,
} from "@/server/pipeline/p0c-pipeline-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "prospect" },
    ({ actor, url }) => listProspects(actor, url),
  );
}

export async function POST(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "prospect" },
    ({ actor, body }) => createProspect(actor, body),
  );
}

export async function PATCH(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "prospect" },
    ({ actor, body }) => patchProspect(actor, body),
  );
}

export function DELETE() {
  return methodNotAllowed("GET, POST, PATCH");
}
