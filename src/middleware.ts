import NextAuth from "next-auth";
import { authConfig } from "@/auth";

const { auth: middleware } = NextAuth({
  ...authConfig,
});

export default middleware((req) => {
  // Optionele extra middleware logica hier indien nodig
});

export const config = {
  matcher: [
    /*
     * Match alle routes BEHALVE:
     * - api (API routes, inclusief /api/auth/*)
     * - _next/static (Next.js static bestanden)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - login pagina (publiek)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|login).*)",
  ],
};
