import { redirect } from 'next/navigation';

// The standalone Publishing leaderboard merged into /analytics as a section.
// Redirect so existing links / push notifications keep working.
export default function PublishingLeaderboardPage() {
  redirect('/analytics');
}
