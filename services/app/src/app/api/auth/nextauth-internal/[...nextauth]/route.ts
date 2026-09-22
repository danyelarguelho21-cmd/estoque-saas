// Rotas internas do NextAuth (sessão/callback/csrf) — ver comentário em modules/auth/auth.config.ts
// sobre por que isto vive em um basePath separado de /api/auth/{login,logout,signup}.
import { handlers } from "@/modules/auth";

export const { GET, POST } = handlers;
