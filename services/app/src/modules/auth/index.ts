// Módulo: auth — login, sessão (Auth.js), convite de usuários, RBAC.
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts, nunca de arquivos
// internos (ver ADR-001 — monolito modular).
export { handlers, auth, signIn, signOut } from "./auth.config";
export { requireSession, requireRole, type SessionContext } from "./rbac";
export { signupTenant, type SignupInput, type SignupResult } from "./signup";
export { inviteUser, type InviteUserInput, type InviteUserResult } from "./invite";
export { hashPassword, verifyPassword } from "./password";
export { getTenant, updateTenant, type UpdateTenantInput } from "./tenant";
export { listStores, createStore, updateStore, type StoreInput, type StoreUpdateInput, type ListStoresFilters } from "./stores";
export { listUsers, updateUserRole, type ListUsersFilters } from "./users";
