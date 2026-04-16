import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton so the Realtime socket + its auth listener are attached once per
// tab, not per hook instance.
let cached: SupabaseClient | null = null

export function createClient() {
  if (cached) return cached

  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )

  // @supabase/ssr 0.10 wires auth state into the HTTP layer but not the
  // Realtime socket. Without this, postgres_changes on RLS-protected tables
  // connect as anon and every row is filtered out before delivery.
  void client.auth.getSession().then(({ data }) => {
    client.realtime.setAuth(data.session?.access_token ?? null)
  })
  client.auth.onAuthStateChange((_event, session) => {
    client.realtime.setAuth(session?.access_token ?? null)
  })

  cached = client
  return client
}
