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
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { api } from '../../lib/api';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';
const MIN_PLACEMENTS = 3;

interface Assignment {
  id: string;
  status: string;
  expiresAt: string;
  assignedAt: string;
  // Confirmed placements made WITHIN THIS assignment window (by the
  // current user, since `assignedAt`). Not a lifetime count.
  confirmedCount: number;
  /** For channel_growth packages only — random photos pulled from the
   *  company's property pool, deterministic per assignment. Lets agents
   *  attach a real apartment photo to the FB/WA promo post. */
  growthMedia?: Array<{ file: { id: string; mimeType: string } }>;
  postPackage: {
    id: string;
    title: string | null;
    shortCaption: string | null;
    whatsappCaption: string | null;
    kind: 'property_listing' | 'channel_growth';
    growthTargetUrl: string | null;
    growthTargetLabel: string | null;
    growthTargetKind: string | null;
    property: {
      id: string;
      code: string;
      name: string;
      area: string | null;
      priceAed: string | null;
      media: Array<{ file: { id: string; mimeType: string } }>;
    } | null;
    trackingLink: { shortUrl: string; whatsappUrl: string } | null;
  };
}

interface Placement {
  id: string;
  channelName: string | null;
  channelKind: string | null;
  externalUrl: string | null;
  groupSize: number | null;
  publishedAt: string;
  trackingSlug: string | null;
  confirmedAt: string | null;
}

interface DraftResponse {
  id: string;
  trackingSlug: string;
  trackingUrl: string | null;
  postCode: string | null;
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
  const isGrowth = a.postPackage.kind === 'channel_growth';
  const prop = a.postPackage.property;
  // For growth tasks, pull the cover photo from the random pool stamped
  // server-side. Otherwise use the property's first photo.
  const photo = isGrowth ? a.growthMedia?.[0]?.file : prop?.media?.[0]?.file;
  const assignedAt = new Date(a.assignedAt);
  const windowEnd = new Date(assignedAt.getTime() + 60 * 60 * 1000); // 1h ideal window
  const hoursLeft = Math.max(0, Math.floor((new Date(a.expiresAt).getTime() - Date.now()) / 3_600_000));

  const headline = isGrowth
    ? (a.postPackage.title ?? 'Grow our channel')
    : `${prop?.code ?? '?'} — ${prop?.name ?? ''}`;
  const sub = isGrowth
    ? (a.postPackage.growthTargetLabel ?? 'Channel growth')
    : (prop?.area ?? '');

  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 12,
        overflow: 'hidden',
        borderLeftWidth: isGrowth ? 4 : 0,
        borderLeftColor: '#7C3AED',
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 1,
      }}
    >
      {isGrowth ? (
        <View style={{ backgroundColor: '#F5F3FF', paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="megaphone" size={14} color="#7C3AED" />
          <Text style={{ fontSize: 11, color: '#5B21B6', fontWeight: '700', letterSpacing: 0.5 }}>
            GROW CHANNEL
          </Text>
        </View>
      ) : null}
      {photo ? (
        <Image
          source={{ uri: `${API_BASE}/public/files/${photo.id}` }}
          style={{ width: '100%', height: 160 }}
          resizeMode="cover"
        />
      ) : null}
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ fontWeight: '700', color: '#061D3F', flex: 1 }}>{headline}</Text>
          <Text style={{ fontSize: 11, color: hoursLeft < 6 ? '#DC2626' : '#64748B', fontWeight: '600' }}>
            {hoursLeft}h left
          </Text>
        </View>
        <Text style={{ color: '#64748B', fontSize: 12 }}>{sub}</Text>
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="time-outline" size={14} color="#0F766E" />
          <Text style={{ color: '#0F766E', fontSize: 12, fontWeight: '600' }}>
            Publish window: {fmtTime(assignedAt.toISOString())} – {fmtTime(windowEnd.toISOString())}
          </Text>
        </View>
        <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>
          {a.confirmedCount} of {MIN_PLACEMENTS} placements logged · tap to publish
        </Text>
      </View>
    </Pressable>
  );
}

function PublishFlow({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const isGrowth = a.postPackage.kind === 'channel_growth';
  const prop = a.postPackage.property;
  // Growth tasks use the random photo pool from the company's properties;
  // listings use the property's own photos. Same shape, same UI.
  const allPhotos = isGrowth ? (a.growthMedia ?? []) : (prop?.media ?? []);
  const photo = allPhotos[0]?.file;
  const caption = a.postPackage.whatsappCaption ?? a.postPackage.shortCaption ?? prop?.name ?? '';
  const trackingShort = a.postPackage.trackingLink?.shortUrl ?? '';
  const headerCode = isGrowth ? '📣 GROW' : (prop?.code ?? '');
  const headerName = isGrowth
    ? (a.postPackage.title ?? a.postPackage.growthTargetLabel ?? 'Channel growth')
    : (prop?.name ?? '');

  const [generating, setGenerating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [lastCopiedSlug, setLastCopiedSlug] = useState<string | null>(null);

  async function loadPlacements() {
    try {
      const data = await api<Placement[]>(`/post-packages/${a.postPackage.id}/placements/mine`);
      setPlacements(data);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadPlacements();
  }, []);

  // Drafts are always live (created in this session). Confirmed posts are
  // only counted toward THIS assignment if they were confirmed after the
  // assignment was created — past placements from prior assignments don't
  // pre-fill the 3/3 quota.
  const assignedAtMs = new Date(a.assignedAt).getTime();
  const drafts = placements.filter((p) => p.confirmedAt === null);
  const confirmed = placements.filter(
    (p) => p.confirmedAt !== null && new Date(p.confirmedAt).getTime() >= assignedAtMs,
  );
  const confirmedCount = confirmed.length;
  const canComplete = confirmedCount >= MIN_PLACEMENTS;

  async function shareCaption() {
    const body = `${caption}\n\n${trackingShort}`;
    await Share.share({ message: body });
  }

  /** One-tap: create a draft placement on the server, copy its unique
   *  tracking URL to the clipboard. Agent now goes to the FB group, posts
   *  with this URL, then comes back to confirm where they posted. */
  async function generateAndCopyLink() {
    setGenerating(true);
    try {
      const res = await api<DraftResponse>(
        `/post-packages/${a.postPackage.id}/placements/draft`,
        { method: 'POST' },
      );
      if (res.trackingUrl) {
        setLastCopiedSlug(res.trackingSlug);
        // Share sheet — let the agent send the link straight to WhatsApp
        // group / FB Messenger / Notes / Copy. Native modules are off the
        // table to keep the build OTA-able, so this beats Clipboard for now.
        await Share.share({
          message: res.trackingUrl,
        });
        Alert.alert(
          '🎯 Link ready',
          `Paste it in your next FB/WA group post. When you come back, tap the orange card to tell us which group.`,
        );
      }
      await loadPlacements();
    } catch (err) {
      Alert.alert('Failed', (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraftLink(slug: string | null) {
    if (!slug || !trackingShort) return;
    const url = `${trackingShort}?s=${slug}`;
    setLastCopiedSlug(slug);
    await Share.share({ message: url });
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
        const filePrefix = prop?.code ?? `growth-${a.id.slice(0, 6)}`;
        const localPath = `${FileSystem.cacheDirectory}${filePrefix}-${i + 1}.${ext}`;
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
          {confirmedCount}/{MIN_PLACEMENTS}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F' }}>{headerCode}</Text>
        <Text style={{ color: '#64748B' }}>{headerName}</Text>

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
          {allPhotos.length > 0 ? (
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
          ) : null}
        </View>

        <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginTop: 16 }}>
          Caption to use
        </Text>
        <View style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginTop: 6 }}>
          <Text style={{ color: '#0F172A', fontSize: 13 }}>{caption}</Text>
          <Text style={{ color: '#00A7A5', fontSize: 13, marginTop: 8 }}>{trackingShort}</Text>
        </View>

        <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginTop: 24 }}>
          Post in groups ({confirmedCount}/{MIN_PLACEMENTS} confirmed)
        </Text>

        <Pressable
          onPress={generateAndCopyLink}
          disabled={generating}
          style={{
            marginTop: 8,
            backgroundColor: generating ? '#94A3B8' : '#00A7A5',
            padding: 16,
            borderRadius: 12,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Ionicons name="share-outline" color="white" size={20} />
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
            {generating ? 'Generating link…' : 'Get & share unique link'}
          </Text>
        </Pressable>
        <Text style={{ color: '#64748B', fontSize: 11, marginTop: 6, textAlign: 'center' }}>
          Tap → share sheet opens → send straight to your FB/WA group → come back to confirm.
        </Text>

        {drafts.length > 0 ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: '#B45309', fontSize: 12, textTransform: 'uppercase', marginBottom: 6, fontWeight: '700' }}>
              ⏳ Pending — tap to confirm where you posted
            </Text>
            {drafts.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setConfirmingId(p.id)}
                style={{
                  backgroundColor: '#FFFBEB',
                  borderWidth: 1,
                  borderColor: '#F59E0B',
                  padding: 12,
                  borderRadius: 10,
                  marginBottom: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: '#92400E', fontSize: 13 }}>
                    Link [{p.trackingSlug}] {lastCopiedSlug === p.trackingSlug ? '· just copied' : ''}
                  </Text>
                  <Text style={{ color: '#B45309', fontSize: 11, marginTop: 2 }}>
                    Tap to add the group name
                  </Text>
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    copyDraftLink(p.trackingSlug);
                  }}
                  hitSlop={8}
                  style={{
                    backgroundColor: '#F59E0B',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 11, fontWeight: '700' }}>Share again</Text>
                </Pressable>
              </Pressable>
            ))}
          </View>
        ) : null}

        {confirmed.length > 0 ? (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 }}>
              ✓ Confirmed posts
            </Text>
            {confirmed.map((p) => (
              <View key={p.id} style={{ backgroundColor: 'white', padding: 10, borderRadius: 8, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '600', color: '#061D3F', flex: 1 }}>{p.channelName}</Text>
                  {p.trackingSlug ? (
                    <Pressable
                      onPress={() => copyDraftLink(p.trackingSlug)}
                      hitSlop={8}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#E0F2F1', borderRadius: 4 }}
                    >
                      <Text style={{ color: '#0F766E', fontSize: 10, fontWeight: '700' }}>SHARE LINK</Text>
                    </Pressable>
                  ) : null}
                </View>
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
            {completing ? 'Closing task…' : canComplete ? '✓ Mark task complete' : `Need ${MIN_PLACEMENTS - confirmedCount} more placement(s)`}
          </Text>
        </Pressable>
      </ScrollView>

      {confirmingId ? (
        <ConfirmDraftModal
          placementId={confirmingId}
          onClose={() => setConfirmingId(null)}
          onConfirmed={async () => {
            setConfirmingId(null);
            await loadPlacements();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ConfirmDraftModal({
  placementId,
  onClose,
  onConfirmed,
}: {
  placementId: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [channelKind, setChannelKind] = useState('facebook_group');
  const [channelName, setChannelName] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!channelName.trim()) {
      Alert.alert('Group name required', 'Where did you post this link? (e.g. "Dubai Marina FB Group")');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/placements/${placementId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          channelName: channelName.trim(),
          channelKind,
          externalUrl: externalUrl.trim() || undefined,
          groupSize: groupSize ? Number(groupSize) : undefined,
        }),
      });
      onConfirmed();
    } catch (err) {
      Alert.alert('Failed', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
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
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#061D3F', flex: 1 }}>
            Confirm where you posted
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
          <Text style={{ color: '#64748B', fontSize: 13, marginBottom: 12 }}>
            Tell us which group received this link. Only the group name is required.
          </Text>

          <Text style={{ color: '#475569', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 }}>
            Channel type
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
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
                  <Text style={{ color: active ? 'white' : '#475569', fontSize: 12, fontWeight: '600' }}>
                    {k.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field label="Group name (required)">
            <TextInput
              value={channelName}
              onChangeText={setChannelName}
              style={inputStyle}
              placeholder="e.g. Dubai Marina FB Group"
              autoFocus
            />
          </Field>

          <Field label="Public URL of the post (optional)">
            <TextInput
              value={externalUrl}
              onChangeText={setExternalUrl}
              style={inputStyle}
              placeholder="https://facebook.com/..."
              autoCapitalize="none"
              keyboardType="url"
            />
          </Field>

          <Field label="Group size — for reach scoring (optional)">
            <TextInput
              value={groupSize}
              onChangeText={setGroupSize}
              style={inputStyle}
              placeholder="e.g. 12000"
              keyboardType="numeric"
            />
          </Field>

          <Pressable
            onPress={submit}
            disabled={submitting}
            style={{
              marginTop: 24,
              backgroundColor: submitting ? '#94A3B8' : '#16A34A',
              padding: 16,
              borderRadius: 10,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
              {submitting ? 'Confirming…' : '✓ Confirm post'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
