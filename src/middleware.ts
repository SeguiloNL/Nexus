import NextAuth from "next-auth";
import { authConfig } from "@/auth";
import { NextResponse } from "next/server";

const { auth: middleware } = NextAuth({
  ...authConfig,
});

export default middleware((req) => {
  if (req.nextUrl.pathname === "/403") {
    const res = NextResponse.next({ status: 403 });
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }
});

export const config = {
  matcher: [
    /*
     * Match alle routes BEHALVE:
     * - api (API routes, inclusief /api/auth/*)
     * - _next/static (Next.js static bestanden)
     * - _next/image (image optimization files)
     * - favicon.ico + logo afbeeldingen in public/
     * - login pagina (publiek)
     * - wachtwoord vergeten / reset pagina's (publiek)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|favicon-32.png|nexus-logo-full.png|nexus-logo-64.png|nexus-logo-128.png|login|forgot-password|reset-password).*)",
  ],
};
