import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../lib/api';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const KIND_COLOR: Record<string, string> = {
  info: '#0F766E',
  warning: '#B45309',
  alert: '#DC2626',
  success: '#16A34A',
};

export default function NotificationsScreen() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<Notification[]>('/notifications');
      setItems(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}/read`, { method: 'PATCH' });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    } catch {
      // ignore — UI stays optimistic on failure
    }
  }

  async function markAllRead() {
    try {
      await api('/notifications/read-all', { method: 'PATCH' });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
  }, []);

  const unreadCount = items.filter((n) => !n.readAt).length;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      {unreadCount > 0 ? (
        <Pressable onPress={markAllRead} style={{ marginBottom: 12, alignSelf: 'flex-end' }}>
          <Text style={{ color: '#00A7A5', fontSize: 13, fontWeight: '600' }}>
            Mark all as read ({unreadCount})
          </Text>
        </Pressable>
      ) : null}

      {error ? <Text style={{ color: '#DC2626', marginBottom: 12 }}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 48 }}>
            <Text style={{ color: '#64748B' }}>You're all caught up.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const unread = !item.readAt;
          const kindColor = KIND_COLOR[item.kind] ?? '#64748B';
          return (
            <Pressable
              onPress={() => unread && markRead(item.id)}
              style={{
                backgroundColor: 'white',
                padding: 14,
                borderRadius: 12,
                marginBottom: 10,
                borderLeftWidth: 4,
                borderLeftColor: kindColor,
                opacity: unread ? 1 : 0.7,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontWeight: '700', color: '#061D3F', flex: 1 }}>{item.title}</Text>
                {unread ? (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#00A7A5', marginTop: 5 }} />
                ) : null}
              </View>
              {item.body ? (
                <Text style={{ color: '#475569', fontSize: 13, marginBottom: 6 }}>{item.body}</Text>
              ) : null}
              <Text style={{ color: '#94A3B8', fontSize: 11 }}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
