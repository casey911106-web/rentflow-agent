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

type Range = 'today' | 'week';

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
function dubaiDateKey(iso: string): string {
  // Returns 'YYYY-MM-DD' bucketed by Dubai local date so viewings group
  // cleanly across the day boundary regardless of the device's timezone.
  const d = new Date(new Date(iso).getTime() + DUBAI_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}
function dubaiDayLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + DUBAI_OFFSET_MS);
  const today = new Date(Date.now() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + DUBAI_OFFSET_MS + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const key = d.toISOString().slice(0, 10);
  if (key === today) return 'TODAY';
  if (key === tomorrow) return 'TOMORROW';
  // Day name + date — "Wed · 14 May"
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()] ?? '';
  const dayNum = d.getUTCDate();
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] ?? '';
  return `${weekday} · ${dayNum} ${monthName}`;
}

type ListRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; viewing: Viewing };

function buildRows(viewings: Viewing[], range: Range): ListRow[] {
  if (range === 'today') {
    return viewings.map((v) => ({ kind: 'item' as const, key: v.id, viewing: v }));
  }
  const rows: ListRow[] = [];
  let currentKey: string | null = null;
  for (const v of viewings) {
    const k = dubaiDateKey(v.scheduledAt);
    if (k !== currentKey) {
      rows.push({ kind: 'header', key: `h-${k}`, label: dubaiDayLabel(v.scheduledAt) });
      currentKey = k;
    }
    rows.push({ kind: 'item', key: v.id, viewing: v });
  }
  return rows;
}

export default function TodayScreen() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('today');

  async function load(rangeArg?: Range) {
    const r = rangeArg ?? range;
    try {
      const [user, list] = await Promise.all([
        api<Me>('/auth/me'),
        api<Viewing[]>(r === 'week' ? '/field-agents/me/today?range=week' : '/field-agents/me/today'),
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
    load(range);
    const id = setInterval(() => load(range), 60_000);
    return () => clearInterval(id);
  }, [range]);

  const rows = buildRows(viewings, range);

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

      <View style={{ flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 8, padding: 2, marginBottom: 12 }}>
        {(['today', 'week'] as Range[]).map((r) => {
          const active = range === r;
          return (
            <Pressable
              key={r}
              onPress={() => setRange(r)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 6,
                backgroundColor: active ? 'white' : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontWeight: '700', color: active ? '#061D3F' : '#64748B', fontSize: 13 }}>
                {r === 'today' ? 'Today' : 'This week'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={{ color: '#DC2626', marginBottom: 12 }}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(range); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 48 }}>
            <Ionicons name="calendar-clear-outline" color="#CBD5E1" size={48} />
            <Text style={{ color: '#64748B', marginTop: 8 }}>
              {range === 'today' ? 'No viewings scheduled today.' : 'No viewings this week.'}
            </Text>
          </View>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: '#475569',
                  letterSpacing: 0.5,
                  marginTop: 8,
                  marginBottom: 6,
                }}
              >
                {row.label}
              </Text>
            );
          }
          const item = row.viewing;
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
