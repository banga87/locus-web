// Settings index. No landing page yet — redirect straight to the
// agent-access page, which is the primary (and most-used) settings
// surface today. Will be replaced by a real nav landing page later.

import { redirect } from 'next/navigation';

export default function SettingsPage() {
  redirect('/settings/agent-access');
}
