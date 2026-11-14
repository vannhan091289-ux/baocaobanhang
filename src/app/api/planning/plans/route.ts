import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createSalesPlan,
  listSalesPlans,
  patchSalesPlan,
} from "@/server/planning/p0b1-service";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "sales_plan" },
    ({ actor, url }) => listSalesPlans(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "sales_plan" },
    ({ actor, body }) => createSalesPlan(actor, body),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "sales_plan" },
    ({ actor, body }) => patchSalesPlan(actor, body),
  );
}

export function DELETE(): Response {
  return methodNotAllowed("GET, POST, PATCH");
}
