import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createLead,
  listLeads,
  patchLead,
} from "@/server/pipeline/p0c-pipeline-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "lead" },
    ({ actor, url }) => listLeads(actor, url),
  );
}

export async function POST(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "lead" },
    ({ actor, body }) => createLead(actor, body),
  );
}

export async function PATCH(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "lead" },
    ({ actor, body }) => patchLead(actor, body),
  );
}

export function DELETE() {
  return methodNotAllowed("GET, POST, PATCH");
}
