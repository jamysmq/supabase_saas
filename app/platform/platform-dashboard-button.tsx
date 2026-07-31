'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../src/lib/supabase'

type NotificationSummary = {
  total: number
  operationalCount: number
  hasCritical: boolean
}

export function NotificationBell({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.8"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  )
}

export default function PlatformDashboardButton({
  className = '',
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const [summary, setSummary] = useState<NotificationSummary | null>(null)

  const loadSummary = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) return

    const response = await fetch('/api/platform/notifications/summary', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    })

    if (!response.ok) return
    setSummary(await response.json())
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadSummary(), 0)
    const intervalId = window.setInterval(() => void loadSummary(), 60_000)
    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [loadSummary])

  const hasPending = (summary?.total ?? 0) > 0
  const critical = summary?.hasCritical ?? false

  return (
    <Link
      href="/platform"
      className={`relative inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
        critical
          ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
          : hasPending
            ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
            : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
      } ${className}`}
      aria-label={hasPending ? `Dashboard com ${summary?.total} pendências` : 'Dashboard'}
    >
      <NotificationBell />
      {!compact && <span>Dashboard</span>}
      {hasPending && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
          {summary!.total > 99 ? '99+' : summary!.total}
        </span>
      )}
    </Link>
  )
}
