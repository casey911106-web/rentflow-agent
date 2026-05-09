import { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { api } from '../../lib/api';
import { registerPushTokenIfPossible } from '../../lib/push';

export default function TabsLayout() {
  const [unread, setUnread] = useState(0);
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

  // Register this device for push notifications + handle taps. Only fires
  // once we're inside the (tabs) layout, which means the user is logged in.
  useEffect(() => {
    registerPushTokenIfPossible();

    // Tap on a notification → navigate to the link in the data payload.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { link?: string } | null;
      if (data?.link && typeof data.link === 'string') {
        router.push(data.link as never);
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
        name="tasks"
        options={{
          title: 'Publish tasks',
          tabBarIcon: ({ color, size }) => <Ionicons name="megaphone-outline" color={color} size={size} />,
        }}
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
