// Admin allowlist — ADMIN_CLERK_IDS is a comma-separated list of Clerk user
// IDs, read server-side only (never exposed to the client bundle: no
// NEXT_PUBLIC_ prefix). Used by GET /api/feedback and /admin/feedback.
export function isAdminClerkId(clerkId: string): boolean {
  const adminIds = (process.env.ADMIN_CLERK_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return adminIds.includes(clerkId);
}
