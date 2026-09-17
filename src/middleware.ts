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
     * - favicon.ico + logo afbeeldingen in public/
     * - login pagina (publiek)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|favicon-32.png|nexus-logo-full.png|nexus-logo-64.png|nexus-logo-128.png|login).*)",
  ],
};
