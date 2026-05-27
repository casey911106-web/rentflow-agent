import { useEffect, useRef, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { api } from '../../lib/api';
import { registerPushTokenIfPossible } from '../../lib/push';

// Backend sends web-style links in push payloads. Translate to mobile routes
// — anything unknown lands on /today so taps never throw "unmatched route".
// Old /availability/* and /property-details/* deep links redirect to the new
// /owner-sweeps tab for one release while operators migrate.
function mapPushLinkToMobile(link: string, isAdmin: boolean): string {
  if (link.startsWith('/viewing/') || link.startsWith('/inbox/')
      || link.startsWith('/owner-sweeps/')) return link;
  if (link.startsWith('/availability/') || link.startsWith('/property-details/')) return '/owner-sweeps';
  if (link === '/tasks' || link === '/today' || link === '/inbox'
      || link === '/performance' || link === '/notifications'
      || link === '/owner-sweeps') return link;
  if (link === '/availability' || link === '/property-details') return '/owner-sweeps';
  if (link.startsWith('/leads/')) return isAdmin ? '/inbox' : '/today';
  if (link.startsWith('/posting/')) return '/tasks';
  return '/today';
}

export default function TabsLayout() {
  const [unread, setUnread] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const isAdminRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await api<{ count: number }>('/notifications/unread-count');
        if (active) setUnread(res.count);
      } catch {
        // ignore — token may be missing on first render
      }
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Inbox tab is only for super_admin / ops_manager — field agents don't
  // need (and shouldn't see) the global WhatsApp surface.
  useEffect(() => {
    let active = true;
    api<{ roles: string[] }>('/auth/me')
      .then((me) => {
        const admin = me.roles.some((r) => r === 'super_admin' || r === 'ops_manager');
        if (active) setIsAdmin(admin);
        isAdminRef.current = admin;
      })
      .catch(() => { /* not logged in yet */ });
    return () => { active = false; };
  }, []);

  // Register this device for push notifications + handle taps. Only fires
  // once we're inside the (tabs) layout, which means the user is logged in.
  useEffect(() => {
    registerPushTokenIfPossible();

    // Tap on a notification → navigate to the link in the data payload.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { link?: string } | null;
      if (data?.link && typeof data.link === 'string') {
        router.push(mapPushLinkToMobile(data.link, isAdminRef.current) as never);
      }
    });
    return () => sub.remove();
  }, [router]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#00A7A5',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: { backgroundColor: '#FFFFFF' },
        headerStyle: { backgroundColor: '#061D3F' },
        headerTintColor: '#FFFFFF',
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Today's viewings",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} />,
          // Hide for field agents; admins/ops_managers see it.
          href: isAdmin ? '/inbox' : null,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Publish tasks',
          tabBarIcon: ({ color, size }) => <Ionicons name="megaphone-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="owner-sweeps"
        options={{
          title: 'Owners',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="availability"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="property-details"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          title: 'My performance',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color} size={size} />,
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: '#DC2626', color: 'white', fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
