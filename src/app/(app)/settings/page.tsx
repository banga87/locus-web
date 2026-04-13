// Settings index. Only one settings sub-page exists for Pre-MVP, so we just
// redirect straight to it. Later this will become a real nav landing page.

import { redirect } from 'next/navigation';

export default function SettingsPage() {
  redirect('/settings/agent-tokens');
}
