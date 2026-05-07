import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';

interface Assignment {
  id: string;
  status: string;
  expiresAt: string;
  assignedAt: string;
  postPackage: {
    id: string;
    title: string | null;
    shortCaption: string | null;
    whatsappCaption: string | null;
    property: {
      id: string;
      code: string;
      name: string;
      area: string | null;
      priceAed: string | null;
      media: Array<{ file: { id: string; mimeType: string } }>;
    } | null;
    trackingLink: { shortUrl: string; whatsappUrl: string } | null;
    _count: { placements: number };
  };
}

const CHANNEL_KINDS: Array<{ key: string; label: string }> = [
  { key: 'facebook_group', label: 'Facebook group' },
  { key: 'whatsapp_group', label: 'WhatsApp group' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'classified', label: 'Classified site' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'other', label: 'Other' },
];

export default function TasksScreen() {
  const [items, setItems] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<Assignment | null>(null);

  async function load() {
    try {
      const data = await api<Assignment[]>('/me/assigned-postings');
      setItems(data);
    } catch {
      // ignore
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

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 48 }}>
            <Ionicons name="megaphone-outline" color="#CBD5E1" size={48} />
            <Text style={{ color: '#64748B', marginTop: 8 }}>No publishing tasks right now.</Text>
            <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
              The system rotates tasks hourly. Check back soon.
            </Text>
          </View>
        }
        renderItem={({ item }) => <AssignmentCard a={item} onOpen={() => setActive(item)} />}
      />

      <Modal visible={!!active} animationType="slide" onRequestClose={() => setActive(null)}>
        {active ? <PublishFlow a={active} onClose={() => { setActive(null); load(); }} /> : null}
      </Modal>
    </View>
  );
}

function AssignmentCard({ a, onOpen }: { a: Assignment; onOpen: () => void }) {
  const prop = a.postPackage.property;
  const photo = prop?.media?.[0]?.file;
  const hoursLeft = Math.max(0, Math.floor((new Date(a.expiresAt).getTime() - Date.now()) / 3_600_000));
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 12,
        overflow: 'hidden',
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 1,
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          src={`${API_BASE}/public/files/${photo.id}`}
          style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' } as never}
        />
      ) : null}
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ fontWeight: '700', color: '#061D3F', flex: 1 }}>{prop?.code} — {prop?.name}</Text>
          <Text style={{ fontSize: 11, color: hoursLeft < 6 ? '#DC2626' : '#64748B', fontWeight: '600' }}>
            {hoursLeft}h left
          </Text>
        </View>
        <Text style={{ color: '#64748B', fontSize: 12 }}>{prop?.area}</Text>
        <Text style={{ color: '#0F766E', fontSize: 12, marginTop: 4 }}>
          {a.postPackage._count.placements} placement(s) so far · tap to publish more
        </Text>
      </View>
    </Pressable>
  );
}

function PublishFlow({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const prop = a.postPackage.property;
  const photo = prop?.media?.[0]?.file;
  const caption = a.postPackage.whatsappCaption ?? a.postPackage.shortCaption ?? prop?.name ?? '';
  const trackingShort = a.postPackage.trackingLink?.shortUrl ?? '';

  const [channelKind, setChannelKind] = useState('facebook_group');
  const [channelName, setChannelName] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function shareCaption() {
    const body = `${caption}\n\n${trackingShort}`;
    await Share.share({ message: body });
  }

  async function logPlacement() {
    if (!channelName.trim()) {
      Alert.alert('Channel name required', 'Where did you post it? (e.g. "Dubai Marina FB Group")');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/post-packages/${a.postPackage.id}/placements`, {
        method: 'POST',
        body: JSON.stringify({
          channelName: channelName.trim(),
          channelKind,
          externalUrl: externalUrl.trim() || undefined,
          groupSize: groupSize ? Number(groupSize) : undefined,
        }),
      });
      Alert.alert('Logged ✓', 'Thanks — added to your reach this month.');
      setChannelName('');
      setExternalUrl('');
      setGroupSize('');
    } catch (err) {
      Alert.alert('Failed', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#E2E8F0' }}>
        <Pressable onPress={onClose} style={{ marginRight: 12 }}>
          <Ionicons name="close" color="#475569" size={24} />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#061D3F' }}>Publish task</Text>
      </View>

      <FlatList
        data={[1]}
        keyExtractor={() => 'k'}
        renderItem={() => (
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F' }}>{prop?.code}</Text>
            <Text style={{ color: '#64748B' }}>{prop?.name}</Text>

            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={`${API_BASE}/public/files/${photo.id}`}
                style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 8, marginTop: 12 } as never}
              />
            ) : null}

            <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginTop: 16 }}>
              Caption to use
            </Text>
            <View style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginTop: 6 }}>
              <Text style={{ color: '#0F172A', fontSize: 13 }}>{caption}</Text>
              <Text style={{ color: '#00A7A5', fontSize: 13, marginTop: 8 }}>{trackingShort}</Text>
            </View>

            <Pressable
              onPress={shareCaption}
              style={{
                marginTop: 12,
                backgroundColor: '#00A7A5',
                padding: 14,
                borderRadius: 10,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Share / copy caption</Text>
            </Pressable>

            <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginTop: 24 }}>
              Where did you post?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {CHANNEL_KINDS.map((k) => {
                const active = channelKind === k.key;
                return (
                  <Pressable
                    key={k.key}
                    onPress={() => setChannelKind(k.key)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: active ? '#00A7A5' : '#E2E8F0',
                    }}
                  >
                    <Text style={{ color: active ? 'white' : '#475569', fontSize: 12, fontWeight: '600' }}>{k.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Field label="Channel name (e.g. 'Dubai Marina FB Group')">
              <TextInput
                value={channelName}
                onChangeText={setChannelName}
                style={inputStyle}
                placeholder="Channel name"
              />
            </Field>

            <Field label="Public URL of the post (optional)">
              <TextInput
                value={externalUrl}
                onChangeText={setExternalUrl}
                style={inputStyle}
                placeholder="https://facebook.com/..."
                autoCapitalize="none"
              />
            </Field>

            <Field label="Group / page size (members) — for reach tracking">
              <TextInput
                value={groupSize}
                onChangeText={setGroupSize}
                style={inputStyle}
                placeholder="e.g. 12000"
                keyboardType="numeric"
              />
            </Field>

            <Pressable
              onPress={logPlacement}
              disabled={submitting}
              style={{
                marginTop: 16,
                backgroundColor: submitting ? '#94A3B8' : '#0F766E',
                padding: 14,
                borderRadius: 10,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>
                {submitting ? 'Logging…' : 'Log placement'}
              </Text>
            </Pressable>

            <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 12, textAlign: 'center' }}>
              Tip: post on as many groups/pages as you can. The more reach, the more leads.
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const inputStyle = {
  backgroundColor: 'white',
  padding: 10,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: '#E2E8F0',
  marginTop: 6,
  color: '#0F172A',
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: '#475569', fontSize: 12 }}>{label}</Text>
      {children}
    </View>
  );
}
