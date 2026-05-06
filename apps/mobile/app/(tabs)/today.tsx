import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';

interface Viewing {
  id: string;
  status: string;
  scheduledAt: string;
  property: { code: string; name: string; area: string | null };
  lead: { fullName: string | null; phoneE164: string };
}

export default function TodayScreen() {
  const router = useRouter();
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<Viewing[]>('/field-agents/me/today');
      setViewings(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      {error ? <Text style={{ color: '#DC2626', marginBottom: 12 }}>{error}</Text> : null}

      <FlatList
        data={viewings}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 48 }}>
            <Text style={{ color: '#64748B' }}>No viewings scheduled today.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/viewing/${item.id}`)}
            style={{
              backgroundColor: 'white',
              padding: 16,
              borderRadius: 12,
              marginBottom: 12,
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
              <Text style={{ fontSize: 12, color: '#0F766E', fontWeight: '600' }}>
                {item.status.toUpperCase()}
              </Text>
            </View>
            <Text style={{ fontWeight: '600', color: '#0F172A' }}>
              {item.property.code} — {item.property.name}
            </Text>
            <Text style={{ color: '#64748B', marginTop: 2 }}>
              {item.property.area ?? ''}
            </Text>
            <Text style={{ color: '#334155', marginTop: 6, fontSize: 13 }}>
              👤 {item.lead.fullName ?? item.lead.phoneE164}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
