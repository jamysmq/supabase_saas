import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  return Response.json({
    email: result.platformAdmin.email,
    role: result.platformAdmin.role,
  })
}
