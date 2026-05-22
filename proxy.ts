import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const APP_HOST = "app.meuassistentevirtual.com.br";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();

  if (host === APP_HOST && request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
