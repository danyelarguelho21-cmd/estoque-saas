import { recordAudit, withTenant, type Role } from "@estoque-saas/shared";

export interface ListUsersFilters {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listUsers(tenantId: string, filters: ListUsersFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const users = await tx.user.findMany({
      select: { id: true, name: true, email: true, role: true, status: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = users.length > limit;
    const page = hasMore ? users.slice(0, limit) : users;
    return { items: page, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}

export async function updateUserRole(tenantId: string, actorUserId: string, targetUserId: string, role: Role) {
  return withTenant(tenantId, async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });
    const updated = await tx.user.update({ where: { id: targetUserId }, data: { role } });
    await recordAudit(tx, {
      tenantId,
      userId: actorUserId,
      entityType: "user",
      entityId: targetUserId,
      action: "update",
      before: { role: before.role },
      after: { role: updated.role },
    });
    return updated;
  });
}
