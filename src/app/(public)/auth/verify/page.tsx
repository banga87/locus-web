// /auth/verify — holding page users see right after sign-up. Supabase
// sends them a confirmation email with a link back to /auth/callback; we
// don't do anything here other than tell them to check their inbox.

export default function VerifyPage() {
  return (
    <div className="rounded-lg border border-border bg-background p-6 shadow-sm">
      <h1 className="mb-2 text-lg font-semibold text-foreground">
        Check your email
      </h1>
      <p className="text-sm text-muted-foreground">
        We just sent you a verification link. Click it from the same device
        you signed up on and you&apos;ll land back here ready to set up your
        company.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        Didn&apos;t arrive in a minute or two? Check your spam folder — or
        start over at{' '}
        <a className="underline" href="/signup">
          signup
        </a>
        .
      </p>
    </div>
  );
}
