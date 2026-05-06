import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, clearToken } from '../../lib/api';

interface Viewing {
  id: string;
  status: string;
  scheduledAt: string;
  property: { code: string; name: string; area: string | null };
  lead: { fullName: string | null; phoneE164: string };
}

interface Me {
  id: string;
  fullName: string;
}

const STATUS_COLOR: Record<string, string> = {
  requested: '#94A3B8',
  confirmed: '#0F766E',
  assigned: '#0F766E',
  rescheduled: '#B45309',
  cancelled: '#DC2626',
  no_show: '#F59E0B',
  completed: '#16A34A',
  converted: '#082B5F',
  lost: '#DC2626',
};

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function TodayScreen() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [user, list] = await Promise.all([
        api<Me>('/auth/me'),
        api<Viewing[]>('/field-agents/me/today'),
      ]);
      setMe(user);
      setViewings(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  async function logout() {
    await clearToken();
    router.replace('/login');
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#64748B', fontSize: 12 }}>{greetingFor(new Date())}</Text>
          <Text style={{ color: '#061D3F', fontSize: 18, fontWeight: '700' }}>
            {me?.fullName?.split(' ')[0] ?? 'Agent'}
          </Text>
        </View>
        <Pressable onPress={logout} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="log-out-outline" color="#64748B" size={20} />
          <Text style={{ color: '#64748B', fontSize: 13 }}>Sign out</Text>
        </Pressable>
      </View>

      {error ? <Text style={{ color: '#DC2626', marginBottom: 12 }}>{error}</Text> : null}

      <FlatList
        data={viewings}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 48 }}>
            <Ionicons name="calendar-clear-outline" color="#CBD5E1" size={48} />
            <Text style={{ color: '#64748B', marginTop: 8 }}>No viewings scheduled today.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const color = STATUS_COLOR[item.status] ?? '#64748B';
          return (
            <Pressable
              onPress={() => router.push(`/viewing/${item.id}`)}
              style={{
                backgroundColor: 'white',
                padding: 16,
                borderRadius: 12,
                marginBottom: 12,
                borderLeftWidth: 4,
                borderLeftColor: color,
                shadowColor: '#0F172A',
                shadowOpacity: 0.05,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 1,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ fontWeight: '700', color: '#061D3F' }}>
                  {new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={{ fontSize: 11, color, fontWeight: '700', textTransform: 'uppercase' }}>
                  {item.status.replace(/_/g, ' ')}
                </Text>
              </View>
              <Text style={{ color: '#061D3F', fontWeight: '600' }}>{item.property.name}</Text>
              <Text style={{ color: '#64748B', fontSize: 12 }}>
                {item.property.code} · {item.property.area ?? '—'}
              </Text>
              <Text style={{ color: '#64748B', fontSize: 12, marginTop: 6 }}>
                Lead: {item.lead.fullName ?? item.lead.phoneE164}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
