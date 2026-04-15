// HTML returned after POST /api/oauth/authorize/approve.
// - Hidden iframe delivers the code to the localhost redirect_uri.
// - Visible branded success message.
// - Fallback <a> revealed via CSS after 5s (pure CSS, no JS).
// - <meta refresh> is a last-resort fallback if the iframe is blocked.
//
// Dependency-free: returns a string, rendered by the approve route as
// an HTML Response.

export function buildSuccessPageHtml(params: { redirectTarget: string }): string {
  const target = escapeHtml(params.redirectTarget);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Connected to Locus</title>
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="8;url=${target}">
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #fafafa; color: #111; }
    .card { text-align: center; padding: 2rem; max-width: 28rem; }
    h1 { font-size: 1.5rem; margin: 1rem 0 0.5rem; }
    p { color: #555; line-height: 1.5; }
    .check { width: 4rem; height: 4rem; border-radius: 50%; background: #10b981; display: inline-grid; place-items: center; color: white; font-size: 2rem; }
    .fallback { opacity: 0; animation: reveal 0s linear 5s forwards; margin-top: 1.5rem; }
    @keyframes reveal { to { opacity: 1; } }
    iframe { display: none; }
  </style>
</head>
<body>
  <main class="card">
    <div class="check">\u2713</div>
    <h1>Connected to Locus</h1>
    <p>You can close this tab and return to your app.</p>
    <p class="fallback"><a href="${target}">Click here if nothing happened</a></p>
  </main>
  <iframe src="${target}" sandbox="allow-same-origin allow-scripts"></iframe>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
