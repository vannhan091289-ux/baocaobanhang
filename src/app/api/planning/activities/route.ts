import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createActivity,
  listActivities,
  patchActivity,
} from "@/server/planning/p0b1-service";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "activity_log" },
    ({ actor, url }) => listActivities(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "activity_log" },
    ({ actor, body }) => createActivity(actor, body),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "activity_log" },
    ({ actor, body }) => patchActivity(actor, body),
  );
}

export function DELETE(): Response {
  return methodNotAllowed("GET, POST, PATCH");
}
