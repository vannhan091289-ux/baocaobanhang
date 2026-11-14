import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createOpportunity,
  listOpportunities,
  patchOpportunity,
} from "@/server/pipeline/p0c-pipeline-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "opportunity" },
    ({ actor, url }) => listOpportunities(actor, url),
  );
}

export async function POST(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "opportunity" },
    ({ actor, body }) => createOpportunity(actor, body),
  );
}

export async function PATCH(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "opportunity" },
    ({ actor, body }) => patchOpportunity(actor, body),
  );
}

export function DELETE() {
  return methodNotAllowed("GET, POST, PATCH");
}
