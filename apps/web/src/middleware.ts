import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyJwt } from "@/lib/auth/jwt-verify";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only API routes and real static assets bypass auth. Do not exempt any
  // path merely because it contains a dot — application routes such as
  // /admin/export.csv must still be checked.
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const disableAuth = process.env.NEXT_PUBLIC_DISABLE_AUTH === "true";
  if (disableAuth) {
    console.warn("⚠️ SECURITY WARNING: Authentication is disabled globally via NEXT_PUBLIC_DISABLE_AUTH.");
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // Only the httpOnly refresh cookie is available to middleware. Never trust
  // an arbitrary auth_session cookie as a session marker.
  const refreshToken = request.cookies.get("refreshToken")?.value;

  // Validate the token for every protected route; mere cookie presence is not
  // proof of an authenticated or unrevoked session.
  let user = null;
  if (refreshToken) {
    user = await verifyJwt(refreshToken);
  }

  if (pathname.startsWith("/admin")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
    if (!user.isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  if (!isPublic && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  // A public auth page must not bounce back to /dashboard when the refresh
  // cookie is stale/revoked: verifyJwt already failed above, so let the user
  // reach the login form. Never delete cookies in response to a GET query
  // parameter — logout belongs in a POST endpoint, not in middleware.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except API routes, Next.js internals and real
     * static files (paths whose last segment contains a dot).
     */
    "/((?!api/|_next/|_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)",
  ],
};
