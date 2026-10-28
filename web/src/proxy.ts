import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "jp_session";

/**
 * Cheap gate: bounce to /login when there is no session cookie at all. The Express API
 * verifies the signature on every request, so a forged cookie still gets 401s.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname, search } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API rewrite, Next internals and static files.
  matcher: ["/((?!api/|_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
