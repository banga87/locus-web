// Consent form rendered on the /auth/mcp page.
//
// Server component — no interactivity needed. Two plain HTML forms POST
// to /api/oauth/authorize/approve and /api/oauth/authorize/deny. The
// session_ref is carried as a hidden field.
//
// V1 CSRF: no explicit token. Browser default SameSite=Lax means the
// Supabase session cookie is not sent on cross-origin POSTs, so a
// malicious site's form submit here lands without auth and requireAuth()
// rejects it. Revisit if the auth cookie ever needs SameSite=None.

import { Button } from '@/components/ui/button';

export function ConsentForm({ sessionRef }: { sessionRef: string }) {
  return (
    <div className="flex gap-3">
      <form method="post" action="/api/oauth/authorize/deny">
        <input type="hidden" name="session_ref" value={sessionRef} />
        <Button type="submit" variant="ghost" size="lg">
          Cancel
        </Button>
      </form>
      <form method="post" action="/api/oauth/authorize/approve">
        <input type="hidden" name="session_ref" value={sessionRef} />
        <Button type="submit" variant="default" size="lg">
          Connect
        </Button>
      </form>
    </div>
  );
}
