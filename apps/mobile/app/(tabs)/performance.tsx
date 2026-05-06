import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from '../../lib/api';

interface Me {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
}

interface Stats {
  viewingsToday: number;
  viewingsCompletedThisWeek: number;
  noShowRate: number | null;
  conversionRate: number | null;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  ops_manager: 'Ops manager',
  field_agent: 'Field agent',
};

export default function PerformanceScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [user, todayList] = await Promise.all([
        api<Me>('/auth/me'),
        api<Array<{ status: string }>>('/field-agents/me/today').catch(() => []),
      ]);
      setMe(user);
      setStats({
        viewingsToday: todayList.length,
        viewingsCompletedThisWeek: todayList.filter((v) => v.status === 'completed').length,
        noShowRate: null,
        conversionRate: null,
      });
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
    <ScrollView
      style={{ flex: 1, backgroundColor: '#F8FAFC' }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      {error ? (
        <Text style={{ color: '#DC2626', marginBottom: 12 }}>{error}</Text>
      ) : null}

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase' }}>
          Signed in as
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F', marginTop: 4 }}>
          {me?.fullName ?? '—'}
        </Text>
        <Text style={{ color: '#64748B', marginBottom: 8 }}>{me?.email}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(me?.roles ?? []).map((r) => (
            <View key={r} style={{ backgroundColor: '#E0F7F7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>
              <Text style={{ color: '#00A7A5', fontSize: 11, fontWeight: '600' }}>
                {ROLE_LABEL[r] ?? r}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#061D3F', marginBottom: 12 }}>
          Today
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Stat label="Viewings" value={stats?.viewingsToday ?? 0} />
          <Stat label="Completed" value={stats?.viewingsCompletedThisWeek ?? 0} />
        </View>
        <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 14 }}>
          More breakdown (no-show rate, conversion %, week / month / year) will appear here once you have completed viewings.
        </Text>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 28, fontWeight: '700', color: '#061D3F' }}>{value}</Text>
      <Text style={{ color: '#64748B', fontSize: 12 }}>{label}</Text>
    </View>
  );
}
