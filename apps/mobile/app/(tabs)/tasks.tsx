import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { api } from '../../lib/api';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';
const MIN_PLACEMENTS = 3;

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

interface Placement {
  id: string;
  channelName: string;
  channelKind: string | null;
  externalUrl: string | null;
  groupSize: number | null;
  publishedAt: string;
}

const CHANNEL_KINDS: Array<{ key: string; label: string }> = [
  { key: 'facebook_group', label: 'Facebook group' },
  { key: 'whatsapp_group', label: 'WhatsApp group' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'classified', label: 'Classified site' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'other', label: 'Other' },
];

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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

      <Modal
        visible={!!active}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActive(null)}
      >
        {active ? <PublishFlow a={active} onClose={() => { setActive(null); load(); }} /> : null}
      </Modal>
    </View>
  );
}

function AssignmentCard({ a, onOpen }: { a: Assignment; onOpen: () => void }) {
  const prop = a.postPackage.property;
  const photo = prop?.media?.[0]?.file;
  const assignedAt = new Date(a.assignedAt);
  const windowEnd = new Date(assignedAt.getTime() + 60 * 60 * 1000); // 1h ideal window
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
        <Image
          source={{ uri: `${API_BASE}/public/files/${photo.id}` }}
          style={{ width: '100%', height: 160 }}
          resizeMode="cover"
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
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="time-outline" size={14} color="#0F766E" />
          <Text style={{ color: '#0F766E', fontSize: 12, fontWeight: '600' }}>
            Publish window: {fmtTime(assignedAt.toISOString())} – {fmtTime(windowEnd.toISOString())}
          </Text>
        </View>
        <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>
          {a.postPackage._count.placements} of {MIN_PLACEMENTS} placements logged · tap to publish
        </Text>
      </View>
    </Pressable>
  );
}

function PublishFlow({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const prop = a.postPackage.property;
  const photo = prop?.media?.[0]?.file;
  const allPhotos = prop?.media ?? [];
  const caption = a.postPackage.whatsappCaption ?? a.postPackage.shortCaption ?? prop?.name ?? '';
  const trackingShort = a.postPackage.trackingLink?.shortUrl ?? '';

  const [channelKind, setChannelKind] = useState('facebook_group');
  const [channelName, setChannelName] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [placements, setPlacements] = useState<Placement[]>([]);

  async function loadPlacements() {
    try {
      const data = await api<Placement[]>(`/post-packages/${a.postPackage.id}/placements/mine`);
      setPlacements(data);
    } catch {
      // ignore — endpoint may 404 if missing, count from assignment instead
    }
  }

  useEffect(() => {
    loadPlacements();
  }, []);

  const placementsCount = placements.length;
  const canComplete = placementsCount >= MIN_PLACEMENTS;

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
      setChannelName('');
      setExternalUrl('');
      setGroupSize('');
      await loadPlacements();
    } catch (err) {
      Alert.alert('Failed', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function markComplete() {
    if (!canComplete) return;
    setCompleting(true);
    try {
      await api(`/post-assignments/${a.id}/complete`, { method: 'POST' });
      Alert.alert('Task complete ✓', 'Great work — moving to the next one.');
      onClose();
    } catch (err) {
      Alert.alert('Failed', (err as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  async function downloadPhotos() {
    if (allPhotos.length === 0) {
      Alert.alert('No photos', 'This property has no media.');
      return;
    }
    const toSave = allPhotos.slice(0, 5);

    // Permissions
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow Photos access to save the property images to your camera roll.');
      return;
    }

    setDownloading(true);
    setDownloadProgress(0);
    let saved = 0;
    for (let i = 0; i < toSave.length; i++) {
      const m = toSave[i]!;
      try {
        const url = `${API_BASE}/public/files/${m.file.id}`;
        const ext = m.file.mimeType.includes('png') ? 'png' : m.file.mimeType.includes('webp') ? 'webp' : 'jpg';
        const localPath = `${FileSystem.cacheDirectory}${prop?.code}-${i + 1}.${ext}`;
        const result = await FileSystem.downloadAsync(url, localPath);
        if (result.status === 200) {
          await MediaLibrary.saveToLibraryAsync(result.uri);
          saved++;
        }
        setDownloadProgress(i + 1);
      } catch {
        // skip
      }
    }
    setDownloading(false);
    Alert.alert(
      saved > 0 ? '✓ Saved' : 'Failed',
      saved > 0
        ? `${saved} photo${saved > 1 ? 's' : ''} saved to camera roll.`
        : 'Could not save photos. Try again.',
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={['top', 'bottom']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderColor: '#E2E8F0',
          backgroundColor: 'white',
        }}
      >
        <Pressable onPress={onClose} hitSlop={12} style={{ marginRight: 12 }}>
          <Ionicons name="close" color="#475569" size={28} />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#061D3F', flex: 1 }}>Publish task</Text>
        <Text style={{ color: canComplete ? '#16A34A' : '#94A3B8', fontWeight: '700', fontSize: 13 }}>
          {placementsCount}/{MIN_PLACEMENTS}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F' }}>{prop?.code}</Text>
        <Text style={{ color: '#64748B' }}>{prop?.name}</Text>

        {photo ? (
          <Image
            source={{ uri: `${API_BASE}/public/files/${photo.id}` }}
            style={{ width: '100%', height: 220, borderRadius: 8, marginTop: 12 }}
            resizeMode="cover"
          />
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable
            onPress={shareCaption}
            style={{ flex: 1, backgroundColor: '#00A7A5', padding: 14, borderRadius: 10, alignItems: 'center' }}
          >
            <Text style={{ color: 'white', fontWeight: '700' }}>Share caption</Text>
          </Pressable>
          <Pressable
            onPress={downloadPhotos}
            disabled={downloading}
            style={{ flex: 1, backgroundColor: downloading ? '#94A3B8' : '#0F766E', padding: 14, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
          >
            <Ionicons name="download-outline" color="white" size={18} />
            <Text style={{ color: 'white', fontWeight: '700' }}>
              {downloading
                ? `Saving ${downloadProgress}/${Math.min(5, allPhotos.length)}…`
                : `Save ${Math.min(5, allPhotos.length)} photos`}
            </Text>
          </Pressable>
        </View>

        <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginTop: 16 }}>
          Caption to use
        </Text>
        <View style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginTop: 6 }}>
          <Text style={{ color: '#0F172A', fontSize: 13 }}>{caption}</Text>
          <Text style={{ color: '#00A7A5', fontSize: 13, marginTop: 8 }}>{trackingShort}</Text>
        </View>

        <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginTop: 24 }}>
          Add a placement ({placementsCount}/{MIN_PLACEMENTS} required)
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

        <Field label="Public URL of the post (recommended)">
          <TextInput
            value={externalUrl}
            onChangeText={setExternalUrl}
            style={inputStyle}
            placeholder="https://facebook.com/..."
            autoCapitalize="none"
            keyboardType="url"
          />
        </Field>

        <Field label="Group size (members) — for reach scoring">
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

        {placements.length > 0 ? (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 }}>
              Already logged
            </Text>
            {placements.map((p) => (
              <View key={p.id} style={{ backgroundColor: 'white', padding: 10, borderRadius: 8, marginBottom: 6 }}>
                <Text style={{ fontWeight: '600', color: '#061D3F' }}>{p.channelName}</Text>
                {p.externalUrl ? <Text style={{ color: '#00A7A5', fontSize: 11 }}>{p.externalUrl}</Text> : null}
                <Text style={{ color: '#64748B', fontSize: 11 }}>
                  {p.channelKind ?? '—'}{p.groupSize ? ` · ${p.groupSize.toLocaleString()} members` : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={markComplete}
          disabled={!canComplete || completing}
          style={{
            marginTop: 24,
            backgroundColor: canComplete ? '#16A34A' : '#CBD5E1',
            padding: 16,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
            {completing ? 'Closing task…' : canComplete ? '✓ Mark task complete' : `Need ${MIN_PLACEMENTS - placementsCount} more placement(s)`}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
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
