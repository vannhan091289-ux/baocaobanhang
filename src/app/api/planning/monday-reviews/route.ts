import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createMondayReviewOrDirective,
  listMondayReviews,
  patchMondayReviewOrDirective,
} from "@/server/planning/p0b1-service";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "monday_review" },
    ({ actor, url }) => listMondayReviews(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "monday_review" },
    ({ actor, body }) => createMondayReviewOrDirective(actor, body),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "monday_review" },
    ({ actor, body }) => patchMondayReviewOrDirective(actor, body),
  );
}

export function DELETE(): Response {
  return methodNotAllowed("GET, POST, PATCH");
}
