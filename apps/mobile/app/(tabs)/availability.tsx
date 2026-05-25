import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';

interface Check {
  id: string;
  expiresAt: string;
  assignedAt: string;
  property: { id: string; code: string; name: string; area: string | null; priceAed: string | null };
  owner: { id: string; fullName: string | null; phoneE164: string };
}

function formatHoursLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `${minutes}m left`;
}

export default function AvailabilityScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<Check[]>('/availability-checks/my');
      setItems(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
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
      <Text style={{ marginBottom: 12, color: '#64748B', fontSize: 12 }}>
        Call the owner and confirm the property is still available. If not, mark it and the
        posting rotation pauses automatically.
      </Text>

      {error ? (
        <Text style={{ color: '#DC2626', marginBottom: 12, fontSize: 13 }}>{error}</Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 64 }}>
            <Text style={{ color: '#64748B' }}>No pending checks 👌</Text>
          </View>
        }
        renderItem={({ item }) => {
          const expired = new Date(item.expiresAt).getTime() <= Date.now();
          return (
            <Pressable
              onPress={() => router.push(`/availability/${item.id}` as never)}
              style={{
                backgroundColor: 'white',
                padding: 14,
                borderRadius: 12,
                marginBottom: 10,
                borderLeftWidth: 4,
                borderLeftColor: expired ? '#DC2626' : '#00A7A5',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontWeight: '700', color: '#061D3F' }}>{item.property.code}</Text>
                <Text style={{ color: expired ? '#DC2626' : '#64748B', fontSize: 12, fontWeight: '600' }}>
                  {formatHoursLeft(item.expiresAt)}
                </Text>
              </View>
              <Text style={{ color: '#475569', fontSize: 13 }}>{item.property.name}</Text>
              {item.property.area ? (
                <Text style={{ color: '#94A3B8', fontSize: 12 }}>{item.property.area}</Text>
              ) : null}
              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                <Text style={{ color: '#94A3B8', fontSize: 12 }}>
                  Owner: {item.owner.fullName ?? item.owner.phoneE164}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
