import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const APP_HOST = "app.meuassistentevirtual.com.br";
const SITE_HOSTS = new Set([
  "meuassistentevirtual.com.br",
  "www.meuassistentevirtual.com.br",
]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const path = request.nextUrl.pathname;

  if (host === APP_HOST && path === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (host && SITE_HOSTS.has(host) && path === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login"],
};
