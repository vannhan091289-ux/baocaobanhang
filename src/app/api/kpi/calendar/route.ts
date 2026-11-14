import { handleApi } from "@/server/api-guard";
import { listCalendarDays, writeCalendarDay } from "@/server/kpi/p0a-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "branch_calendar_day" },
    ({ actor, url }) => listCalendarDays(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "branch_calendar_day" },
    ({ actor, body }) => writeCalendarDay(actor, body, "create"),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "branch_calendar_day" },
    ({ actor, body }) => writeCalendarDay(actor, body, "patch"),
  );
}
