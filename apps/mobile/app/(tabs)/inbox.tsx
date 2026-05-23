import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';

interface ConversationRow {
  id: string;
  leadPhoneE164: string;
  mode: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lead: { id: string; fullName: string | null; status: string; temperature: string } | null;
  _count: { messages: number };
}

interface PendingSuggestion {
  id: string;
  conversation: { id: string };
}

const FILTERS: Array<{ key: 'all' | 'pending' | 'human' | 'ai'; label: string }> = [
  { key: 'all', label: 'Todo' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'human', label: 'Humano' },
  { key: 'ai', label: 'IA' },
];

export default function InboxScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [list, pending] = await Promise.all([
        api<ConversationRow[]>('/whatsapp/conversations'),
        api<PendingSuggestion[]>('/suggestions?status=pending').catch(() => []),
      ]);
      setConversations(list);
      setPendingIds(new Set(pending.map((p) => p.conversation.id)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, 15_000);
      return () => clearInterval(id);
    }, []),
  );

  useEffect(() => {
    load();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const visible = (conversations ?? []).filter((c) => {
    if (filter === 'pending') return pendingIds.has(c.id);
    if (filter === 'human') return c.mode === 'human_takeover';
    if (filter === 'ai') return c.mode === 'ai';
    return true;
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F9FC' }}>
      <View style={{ flexDirection: 'row', padding: 12, gap: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = f.key === 'pending' ? pendingIds.size : null;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={{
                backgroundColor: active ? '#00A7A5' : '#F1F5F9',
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: active ? 'white' : '#0F172A', fontSize: 12, fontWeight: '600' }}>
                {f.label}{count !== null ? ` · ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!conversations ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#00A7A5" />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00A7A5" />}
          ListEmptyComponent={
            <Text style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: 14 }}>
              {error ?? 'Sin conversaciones en este filtro.'}
            </Text>
          }
          renderItem={({ item }) => {
            const pending = pendingIds.has(item.id);
            const lastAt = item.lastInboundAt ?? item.lastOutboundAt;
            return (
              <Pressable
                onPress={() => router.push(`/inbox/${item.id}`)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#F1F5F9' : '#FFFFFF',
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderBottomWidth: 1,
                  borderColor: '#E5E7EB',
                })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '600', color: '#082B5F', fontSize: 15, flex: 1 }} numberOfLines={1}>
                    {item.lead?.fullName ?? item.leadPhoneE164}
                  </Text>
                  {pending ? (
                    <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                      <Text style={{ color: '#B45309', fontSize: 10, fontWeight: '700' }}>● pending</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Courier', fontSize: 11, color: '#64748B' }}>{item.leadPhoneE164}</Text>
                  <Text style={{ fontSize: 11, color: '#64748B' }}>·</Text>
                  <ModeBadge mode={item.mode} />
                </View>
                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                  {item._count.messages} msgs
                  {lastAt ? ` · ${relativeTime(lastAt)}` : ''}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    ai: { label: 'IA', bg: '#CCEEEE', fg: '#0F766E' },
    human_takeover: { label: 'Humano', bg: '#EDE9FE', fg: '#6D28D9' },
    paused: { label: 'Pausada', bg: '#FEF3C7', fg: '#B45309' },
    closed: { label: 'Cerrada', bg: '#E5E7EB', fg: '#475569' },
  };
  const m = map[mode] ?? { label: mode, bg: '#E5E7EB', fg: '#475569' };
  return (
    <View style={{ backgroundColor: m.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 }}>
      <Text style={{ color: m.fg, fontSize: 10, fontWeight: '700' }}>{m.label}</Text>
    </View>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
