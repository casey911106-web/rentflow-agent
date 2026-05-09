import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { formatPriceLines } from '@rentflow/shared';
import { api, uploadFile } from '../../lib/api';

interface ViewingDetail {
  id: string;
  status: string;
  scheduledAt: string;
  durationMinutes: number;
  outcomeNotes: string | null;
  property: {
    id: string;
    code: string;
    name: string;
    type: string;
    area: string | null;
    addressLine: string | null;
    priceAed: string | number | null;
    depositAed: string | number | null;
  };
  lead: { fullName: string | null; phoneE164: string };
  feedback: {
    rating: number | null;
    bookingIntent: string | null;
    comments: string | null;
  } | null;
}

interface PropertyMedia {
  id: string;
  kind: string;
  caption: string | null;
  file: { id: string };
}

const ACTIONS: Array<{ status: string; label: string; color: string }> = [
  { status: 'confirmed',  label: 'On the way',     color: '#00A7A5' },
  { status: 'completed',  label: 'Completed',      color: '#00B894' },
  { status: 'no_show',    label: 'No show',        color: '#F59E0B' },
  { status: 'converted',  label: 'Lead interested', color: '#082B5F' },
  { status: 'lost',       label: 'Lost',           color: '#DC2626' },
];

const ISSUE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'unavailable_when_expected', label: 'Unavailable when expected' },
  { value: 'dirty',                     label: 'Property dirty' },
  { value: 'access_problem',            label: 'Access problem' },
  { value: 'price_changed',             label: 'Price changed' },
  { value: 'owner_not_responding',      label: 'Owner not responding' },
  { value: 'wrong_media',               label: 'Wrong photos / media' },
  { value: 'client_complaint',          label: 'Client complaint' },
  { value: 'maintenance_issue',         label: 'Maintenance issue' },
  { value: 'other',                     label: 'Other' },
];

export default function ViewingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [viewing, setViewing] = useState<ViewingDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [recentUploads, setRecentUploads] = useState<PropertyMedia[]>([]);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0]!.value);
  const [issueText, setIssueText] = useState('');
  const [issueSubmitting, setIssueSubmitting] = useState(false);

  async function load() {
    if (!id) return;
    const data = await api<ViewingDetail>(`/viewings/${id}`);
    setViewing(data);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function updateStatus(status: string) {
    if (!id) return;
    setBusy(status);
    try {
      await api(`/viewings/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      Alert.alert('Update failed', (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pickAndUpload(source: 'camera' | 'library') {
    if (!viewing) return;

    const perms =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perms.granted) {
      Alert.alert('Permission needed', `Allow ${source} access to upload photos.`);
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            allowsMultipleSelection: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            allowsMultipleSelection: true,
          });

    if (result.canceled) return;

    setUploadingCount((c) => c + result.assets.length);
    for (const asset of result.assets) {
      try {
        const fileName =
          asset.fileName ??
          `viewing-${viewing.id}-${Date.now()}.${asset.uri.split('.').pop() ?? 'jpg'}`;
        const mimeType = asset.mimeType ?? 'image/jpeg';
        const media = await uploadFile<PropertyMedia>(
          `/properties/${viewing.property.id}/media`,
          asset.uri,
          fileName,
          mimeType,
          { kind: 'photo', caption: `From viewing ${viewing.id}` },
        );
        setRecentUploads((prev) => [media, ...prev]);
      } catch (err) {
        Alert.alert('Upload failed', (err as Error).message);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
  }

  async function submitIssue() {
    if (!viewing || !issueText.trim()) return;
    setIssueSubmitting(true);
    try {
      await api(`/properties/${viewing.property.id}/report-issue`, {
        method: 'POST',
        body: JSON.stringify({ type: issueType, description: issueText.trim() }),
      });
      setIssueText('');
      setIssueOpen(false);
      Alert.alert('Issue reported', 'The operations team has been notified.');
    } catch (err) {
      Alert.alert('Report failed', (err as Error).message);
    } finally {
      setIssueSubmitting(false);
    }
  }

  if (!viewing) {
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
    >
      {/* Property */}
      <View style={card}>
        <Text style={cardLabel}>Property</Text>
        <Text style={cardTitle}>
          {viewing.property.code} — {viewing.property.name}
        </Text>
        <Text style={cardSubtitle}>
          {viewing.property.area ?? ''}
          {viewing.property.addressLine ? ` · ${viewing.property.addressLine}` : ''}
        </Text>
      </View>

      {/* Pricing — what to quote in person */}
      <View style={[card, { backgroundColor: '#0F172A' }]}>
        <Text style={[cardLabel, { color: '#94A3B8' }]}>Quote these numbers</Text>
        {formatPriceLines({
          type: viewing.property.type,
          priceAed: viewing.property.priceAed,
          depositAed: viewing.property.depositAed,
        })
          .split('\n')
          .map((line, i) => (
            <Text
              key={i}
              style={{ color: 'white', fontSize: 15, fontWeight: i === 0 ? '700' : '500', marginTop: i === 0 ? 4 : 2 }}
            >
              {line}
            </Text>
          ))}
      </View>

      {/* Lead */}
      <View style={card}>
        <Text style={cardLabel}>Lead</Text>
        <Text style={cardTitle}>{viewing.lead.fullName ?? viewing.lead.phoneE164}</Text>
        <Text style={cardSubtitle}>{viewing.lead.phoneE164}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={() => Linking.openURL(`tel:${viewing.lead.phoneE164}`)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#00A7A5',
              padding: 10,
              borderRadius: 8,
              gap: 6,
            }}
          >
            <Ionicons name="call" color="white" size={16} />
            <Text style={{ color: 'white', fontWeight: '600' }}>Call</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const phone = viewing.lead.phoneE164.replace(/[^0-9]/g, '');
              Linking.openURL(`whatsapp://send?phone=${phone}`).catch(() =>
                Linking.openURL(`https://wa.me/${phone}`),
              );
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#25D366',
              padding: 10,
              borderRadius: 8,
              gap: 6,
            }}
          >
            <Ionicons name="logo-whatsapp" color="white" size={16} />
            <Text style={{ color: 'white', fontWeight: '600' }}>WhatsApp</Text>
          </Pressable>
        </View>
      </View>

      {/* Schedule */}
      <View style={card}>
        <Text style={cardLabel}>Scheduled</Text>
        <Text style={cardTitle}>{new Date(viewing.scheduledAt).toLocaleString()}</Text>
        <Text style={cardSubtitle}>
          {viewing.durationMinutes} min · status: {viewing.status}
        </Text>
      </View>

      {/* Lead feedback */}
      <FeedbackCard viewing={viewing} onSaved={load} />

      {/* Outcome notes */}
      {viewing.outcomeNotes ? (
        <View style={card}>
          <Text style={cardLabel}>Notes</Text>
          <Text style={{ color: '#334155', marginTop: 4 }}>{viewing.outcomeNotes}</Text>
        </View>
      ) : null}

      {/* Status update */}
      <Text style={sectionLabel}>Update result</Text>
      {ACTIONS.map((a) => (
        <Pressable
          key={a.status}
          onPress={() => updateStatus(a.status)}
          disabled={busy !== null}
          style={{
            backgroundColor: a.color,
            padding: 14,
            borderRadius: 10,
            alignItems: 'center',
            marginBottom: 8,
            opacity: busy === a.status ? 0.6 : 1,
          }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>{a.label}</Text>
        </Pressable>
      ))}

      {/* Photos */}
      <Text style={sectionLabel}>Photos</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Pressable
          onPress={() => pickAndUpload('camera')}
          disabled={uploadingCount > 0}
          style={{
            flex: 1,
            padding: 14,
            borderRadius: 10,
            alignItems: 'center',
            backgroundColor: '#082B5F',
            opacity: uploadingCount > 0 ? 0.6 : 1,
          }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>📷 Take photo</Text>
        </Pressable>
        <Pressable
          onPress={() => pickAndUpload('library')}
          disabled={uploadingCount > 0}
          style={{
            flex: 1,
            padding: 14,
            borderRadius: 10,
            alignItems: 'center',
            backgroundColor: '#00A7A5',
            opacity: uploadingCount > 0 ? 0.6 : 1,
          }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>🖼  Pick photos</Text>
        </Pressable>
      </View>
      {uploadingCount > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <ActivityIndicator color="#00A7A5" />
          <Text style={{ marginLeft: 8, color: '#64748B' }}>
            Uploading {uploadingCount}…
          </Text>
        </View>
      ) : null}
      {recentUploads.length > 0 ? (
        <View style={{ ...card, marginTop: 0 }}>
          <Text style={cardLabel}>Uploaded this session</Text>
          {recentUploads.map((m) => (
            <Text key={m.id} style={{ color: '#0F766E', fontSize: 12, marginTop: 4 }}>
              ✓ {m.caption ?? m.kind} ({m.file.id.slice(0, 8)}…)
            </Text>
          ))}
        </View>
      ) : null}

      {/* Report issue */}
      <Text style={sectionLabel}>Property issues</Text>
      {!issueOpen ? (
        <Pressable
          onPress={() => setIssueOpen(true)}
          style={{
            padding: 14,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: '#F59E0B',
            backgroundColor: '#FFFBEB',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: '#92400E', fontWeight: '600' }}>⚠️  Report property issue</Text>
        </Pressable>
      ) : (
        <View style={{ ...card, borderColor: '#F59E0B', borderWidth: 1, marginBottom: 24 }}>
          <Text style={cardLabel}>Issue type</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 6, marginBottom: 12 }}
          >
            {ISSUE_TYPES.map((t) => {
              const active = issueType === t.value;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setIssueType(t.value)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    marginRight: 8,
                    borderRadius: 999,
                    backgroundColor: active ? '#082B5F' : '#E5E7EB',
                  }}
                >
                  <Text
                    style={{
                      color: active ? 'white' : '#334155',
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={cardLabel}>Description</Text>
          <TextInput
            value={issueText}
            onChangeText={setIssueText}
            placeholder="Describe what happened…"
            multiline
            numberOfLines={4}
            style={{
              backgroundColor: '#F8FAFC',
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 10,
              padding: 10,
              marginTop: 6,
              minHeight: 90,
              textAlignVertical: 'top',
            }}
          />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable
              onPress={() => setIssueOpen(false)}
              disabled={issueSubmitting}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#E5E7EB',
              }}
            >
              <Text style={{ color: '#334155', fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submitIssue}
              disabled={!issueText.trim() || issueSubmitting}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: '#DC2626',
                opacity: !issueText.trim() || issueSubmitting ? 0.6 : 1,
              }}
            >
              <Text style={{ color: 'white', fontWeight: '600' }}>
                {issueSubmitting ? 'Sending…' : 'Submit issue'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const card = {
  backgroundColor: 'white',
  padding: 16,
  borderRadius: 12,
  marginBottom: 12,
} as const;

const cardLabel = {
  fontSize: 12,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
} as const;

const cardTitle = {
  fontSize: 16,
  fontWeight: '700',
  color: '#061D3F',
  marginTop: 4,
} as const;

const cardSubtitle = {
  color: '#64748B',
  marginTop: 2,
} as const;

const sectionLabel = {
  fontSize: 12,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: '700',
  marginTop: 12,
  marginBottom: 8,
} as const;

function FeedbackCard({
  viewing,
  onSaved,
}: {
  viewing: { id: string; feedback: { rating: number | null; bookingIntent: string | null; comments: string | null } | null };
  onSaved: () => void | Promise<void>;
}) {
  const existing = viewing.feedback;
  const [editing, setEditing] = useState(!existing);
  const [rating, setRating] = useState<number>(existing?.rating ?? 0);
  const [intent, setIntent] = useState<string>(existing?.bookingIntent ?? '');
  const [comments, setComments] = useState<string>(existing?.comments ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await api(`/viewings/${viewing.id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          rating: rating > 0 ? rating : undefined,
          bookingIntent: intent || undefined,
          comments: comments.trim() || undefined,
        }),
      });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing && existing) {
    return (
      <View style={card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={cardLabel}>Lead feedback</Text>
          <Pressable onPress={() => setEditing(true)}>
            <Text style={{ color: '#00A7A5', fontSize: 13, fontWeight: '600' }}>Edit</Text>
          </Pressable>
        </View>
        {existing.rating ? (
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Ionicons
                key={n}
                name={n <= (existing.rating ?? 0) ? 'star' : 'star-outline'}
                color="#F59E0B"
                size={20}
              />
            ))}
          </View>
        ) : null}
        {existing.bookingIntent ? (
          <Text style={{ color: '#334155', marginTop: 6, fontWeight: '600' }}>
            Booking intent: {existing.bookingIntent}
          </Text>
        ) : null}
        {existing.comments ? (
          <Text style={{ color: '#334155', marginTop: 6 }}>{existing.comments}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={card}>
      <Text style={cardLabel}>Lead feedback</Text>

      <Text style={{ color: '#475569', fontSize: 12, marginTop: 8, marginBottom: 4 }}>Rating</Text>
      <View style={{ flexDirection: 'row' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n === rating ? 0 : n)} style={{ marginRight: 4 }}>
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} color="#F59E0B" size={28} />
          </Pressable>
        ))}
      </View>

      <Text style={{ color: '#475569', fontSize: 12, marginTop: 12, marginBottom: 4 }}>Booking intent</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[
          { key: 'yes', label: 'Yes', color: '#16A34A' },
          { key: 'maybe', label: 'Maybe', color: '#F59E0B' },
          { key: 'no', label: 'No', color: '#DC2626' },
        ].map((opt) => {
          const active = intent === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setIntent(active ? '' : opt.key)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: active ? opt.color : '#F1F5F9',
              }}
            >
              <Text style={{ color: active ? 'white' : '#475569', fontWeight: '600' }}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ color: '#475569', fontSize: 12, marginTop: 12, marginBottom: 4 }}>Comments (optional)</Text>
      <TextInput
        value={comments}
        onChangeText={setComments}
        multiline
        numberOfLines={3}
        placeholder="What did the lead say?"
        style={{
          backgroundColor: '#F8FAFC',
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: '#E2E8F0',
          textAlignVertical: 'top',
          minHeight: 60,
          color: '#0F172A',
        }}
      />

      {err ? <Text style={{ color: '#DC2626', marginTop: 8 }}>{err}</Text> : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {existing ? (
          <Pressable
            onPress={() => setEditing(false)}
            style={{ flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#F1F5F9' }}
          >
            <Text style={{ color: '#475569', fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={save}
          disabled={saving || (!rating && !intent && !comments.trim())}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
            backgroundColor: saving || (!rating && !intent && !comments.trim()) ? '#94A3B8' : '#00A7A5',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>{saving ? 'Saving…' : 'Save feedback'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
