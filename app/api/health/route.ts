export async function GET() {
  return Response.json({
    ok: true,
    service: 'billing-app',
    timestamp: new Date().toISOString(),
  })
}

