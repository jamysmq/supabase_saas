'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PlatformPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/platform/tenants')
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100">
      Carregando...
    </main>
  )
}
