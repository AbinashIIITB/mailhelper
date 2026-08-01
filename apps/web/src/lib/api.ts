import { NextResponse } from "next/server";
import { auth } from "@/auth";

type RouteContext<P> = { params: Promise<P> };

/**
 * Wrap a route handler so it only runs for a signed-in user, and hand it the
 * user id instead of making every route unpack the session itself.
 */
export function withUser<P>(
  handler: (
    userId: string,
    req: Request,
    ctx: RouteContext<P>,
  ) => Promise<Response>,
) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(userId, req, ctx);
  };
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function conflict(error: string) {
  return NextResponse.json({ error }, { status: 409 });
}

/** The client identity used for rate limiting. Vercel always sets this header. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
