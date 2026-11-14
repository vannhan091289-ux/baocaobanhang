import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createCustomerReference,
  listCustomerReferences,
} from "@/server/customers/p0d-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "customer_reference" },
    ({ actor, url }) => listCustomerReferences(actor, url),
  );
}

export async function POST(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "customer_reference" },
    ({ actor, body }) => createCustomerReference(actor, body),
  );
}

export function PUT() {
  return methodNotAllowed("GET, POST");
}
export function PATCH() {
  return methodNotAllowed("GET, POST");
}
export function DELETE() {
  return methodNotAllowed("GET, POST");
}
