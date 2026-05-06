import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';

export default function TabsLayout() {
  const [unread, setUnread] = useState(0);

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
