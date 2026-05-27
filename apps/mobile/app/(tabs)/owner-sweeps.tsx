import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { api } from '../../lib/api';

interface SweepItem {
  id: string;
  availability: string | null;
  resolvedAt: string | null;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
    availabilityConfirmedAt: string | null;
    detailsCompletedAt: string | null;
  };
}

interface Sweep {
  id: string;
  status: 'pending' | 'in_progress' | 'closed';
  assignedAt: string | null;
  owner: { id: string; fullName: string | null; phoneE164: string };
  items: SweepItem[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function staleSummary(items: SweepItem[]): string {
  const now = Date.now();
  let staleAvail = 0;
  let staleFaq = 0;
  for (const i of items) {
    const conf = i.property.availabilityConfirmedAt
      ? new Date(i.property.availabilityConfirmedAt).getTime()
      : 0;
    const det = i.property.detailsCompletedAt
      ? new Date(i.property.detailsCompletedAt).getTime()
      : 0;
    if (now - conf > SEVEN_DAYS_MS) staleAvail++;
    if (now - det > NINETY_DAYS_MS) staleFaq++;
  }
  return `${staleAvail} stale availability · ${staleFaq} stale FAQ`;
}

export default function OwnerSweepsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Sweep[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Sweep[]>('/owner-sweeps/my');
      setItems(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, 30_000);
      return () => clearInterval(id);
    }, [load]),
  );

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
        Call each owner and confirm what's still available. Open a sweep to see all their
        properties + send WhatsApp links so they recognise the unit.
      </Text>

      {error ? (
        <Text style={{ color: '#DC2626', marginBottom: 12, fontSize: 13 }}>{error}</Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 64 }}>
            <Text style={{ color: '#64748B' }}>No owner sweeps today 👌</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/owner-sweeps/${item.id}` as never)}
            style={{
              backgroundColor: 'white',
              padding: 14,
              borderRadius: 12,
              marginBottom: 10,
              borderLeftWidth: 4,
              borderLeftColor: item.status === 'in_progress' ? '#F59E0B' : '#00A7A5',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: '#061D3F' }}>
                {item.owner.fullName ?? item.owner.phoneE164}
              </Text>
              <Text style={{ color: '#64748B', fontSize: 12 }}>{item.items.length} props</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>
              {staleSummary(item.items)}
            </Text>
            <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
              {item.status === 'in_progress' ? 'In progress' : 'Pending'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
