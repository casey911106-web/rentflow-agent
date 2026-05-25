import { redirect } from 'next/navigation';

// /dashboard used to render the same funnel KPIs as /analytics. Now that the
// two pages were merged, this route is a permanent redirect so old bookmarks,
// push notification deep links and stale sidebar entries still land somewhere
// useful instead of 404'ing.
export default function DashboardPage() {
  redirect('/analytics');
}
