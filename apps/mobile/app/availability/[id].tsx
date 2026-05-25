import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { api } from '../../lib/api';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';

interface PropertyPhoto {
  id: string;
  file: { id: string; mimeType: string };
}

interface CheckDetail {
  id: string;
  expiresAt: string;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
    media: PropertyPhoto[];
  };
  owner: { id: string; fullName: string | null; phoneE164: string };
}

export default function AvailabilityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [check, setCheck] = useState<CheckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [showUnavail, setShowUnavail] = useState(false);
  const [availableFromDate, setAvailableFromDate] = useState('');
  const [notes, setNotes] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    api<CheckDetail[]>('/availability-checks/my')
      .then((items) => {
        if (!active) return;
        const found = items.find((c) => c.id === id);
        if (!found) setError('This check is no longer assigned to you or has expired.');
        else setCheck(found);
      })
      .catch((err) => active && setError((err as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  async function markAvailable() {
    if (working) return;
    setWorking(true);
    try {
      await api(`/availability-checks/${id}/available`, { method: 'POST' });
      Alert.alert('Confirmed', 'Marked as available. Next check in 7 days.');
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function markUnavailable() {
    if (working) return;
    setWorking(true);
    try {
      await api(`/availability-checks/${id}/unavailable`, {
        method: 'POST',
        body: JSON.stringify({
          availableFromDate: availableFromDate || undefined,
          notes: notes || undefined,
        }),
      });
      Alert.alert(
        'Paused',
        'Marked as not available. Posting rotation has been paused for this property.',
      );
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function savePhotos() {
    if (!check || downloading) return;
    const photos = check.property.media ?? [];
    if (photos.length === 0) {
      Alert.alert('No photos', 'This property has no media to share.');
      return;
    }
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow Photos access so the property images can be saved to your camera roll.');
      return;
    }
    setDownloading(true);
    let saved = 0;
    for (let i = 0; i < photos.length; i++) {
      const m = photos[i]!;
      try {
        const url = `${API_BASE}/public/files/${m.file.id}`;
        const ext = m.file.mimeType.includes('png') ? 'png' : m.file.mimeType.includes('webp') ? 'webp' : 'jpg';
        const localPath = `${FileSystem.cacheDirectory}${check.property.code}-${i + 1}.${ext}`;
        const result = await FileSystem.downloadAsync(url, localPath);
        if (result.status === 200) {
          await MediaLibrary.saveToLibraryAsync(result.uri);
          saved++;
        }
      } catch {
        // skip
      }
    }
    setDownloading(false);
    Alert.alert(
      saved > 0 ? 'Saved' : 'Failed',
      saved > 0
        ? `${saved} photo${saved > 1 ? 's' : ''} saved to your camera roll. Open WhatsApp and attach them to the owner chat.`
        : 'Could not save photos. Try again.',
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  if (error || !check) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: '#DC2626', textAlign: 'center' }}>{error ?? 'Check not found'}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#00A7A5', fontWeight: '600' }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const photos = check.property.media ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8FAFC' }} contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: 'Confirm availability' }} />

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#64748B' }}>Property</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F', marginTop: 2 }}>
          {check.property.code}
        </Text>
        <Text style={{ color: '#475569', marginTop: 2 }}>{check.property.name}</Text>
        {check.property.area ? (
          <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 2 }}>{check.property.area}</Text>
        ) : null}
        {check.property.priceAed ? (
          <Text style={{ color: '#061D3F', fontWeight: '600', marginTop: 8 }}>
            AED {Number(check.property.priceAed).toLocaleString()}
          </Text>
        ) : null}
      </View>

      {photos.length > 0 ? (
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 4 }}>
            Photos to send the owner
          </Text>
          <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
            Owners often don&apos;t recognise a property by code. Save these and attach them in WhatsApp so they know which unit you mean.
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
            {photos.map((p) => (
              <Image
                key={p.id}
                source={{ uri: `${API_BASE}/public/files/${p.file.id}` }}
                style={{ flex: 1, height: 90, borderRadius: 6, backgroundColor: '#E2E8F0' }}
                resizeMode="cover"
              />
            ))}
          </View>
          <Pressable
            onPress={savePhotos}
            disabled={downloading}
            style={{
              backgroundColor: '#0E7490',
              padding: 12,
              borderRadius: 8,
              alignItems: 'center',
              opacity: downloading ? 0.5 : 1,
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700' }}>
              {downloading ? 'Saving…' : `Save ${photos.length} photo${photos.length > 1 ? 's' : ''} to camera roll`}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          <Text style={{ color: '#92400E', fontSize: 12 }}>
            ⚠ No photos on file. The owner may not recognise this property — flag to ops if so.
          </Text>
        </View>
      )}

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#64748B' }}>Contact the owner</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#061D3F', marginTop: 2 }}>
          {check.owner.fullName ?? '(no name)'}
        </Text>
        <Text style={{ color: '#475569', marginTop: 2 }}>{check.owner.phoneE164}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable
            onPress={() => Linking.openURL(`tel:${check.owner.phoneE164}`)}
            style={{
              flex: 1,
              backgroundColor: '#00A7A5',
              padding: 12,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '600' }}>Call</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(`https://wa.me/${check.owner.phoneE164.replace('+', '')}`)}
            style={{
              flex: 1,
              backgroundColor: '#25D366',
              padding: 12,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '600' }}>WhatsApp</Text>
          </Pressable>
        </View>
      </View>

      {!showUnavail ? (
        <View style={{ gap: 12 }}>
          <Pressable
            onPress={markAvailable}
            disabled={working}
            style={{
              backgroundColor: '#16A34A',
              padding: 16,
              borderRadius: 12,
              alignItems: 'center',
              opacity: working ? 0.5 : 1,
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>
              ✅ Still available
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowUnavail(true)}
            disabled={working}
            style={{
              backgroundColor: 'white',
              padding: 16,
              borderRadius: 12,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#FCA5A5',
            }}
          >
            <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 16 }}>
              ❌ Not available
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#061D3F', marginBottom: 8 }}>
            Mark as not available
          </Text>
          <Text style={{ color: '#64748B', fontSize: 12, marginBottom: 12 }}>
            Posting rotation pauses immediately. If the owner said when it&apos;ll be free again, add it below (optional).
          </Text>

          <Text style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
            Free again on (YYYY-MM-DD)
          </Text>
          <TextInput
            value={availableFromDate}
            onChangeText={setAvailableFromDate}
            placeholder="2026-06-15"
            placeholderTextColor="#94A3B8"
            style={{
              backgroundColor: '#F8FAFC',
              padding: 10,
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 12,
            }}
          />

          <Text style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. already rented, owner not responding, etc."
            placeholderTextColor="#94A3B8"
            multiline
            style={{
              backgroundColor: '#F8FAFC',
              padding: 10,
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 16,
              minHeight: 60,
            }}
          />

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => setShowUnavail(false)}
              disabled={working}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 8,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#CBD5E1',
              }}
            >
              <Text style={{ color: '#475569', fontWeight: '600' }}>Back</Text>
            </Pressable>
            <Pressable
              onPress={markUnavailable}
              disabled={working}
              style={{
                flex: 2,
                backgroundColor: '#DC2626',
                padding: 14,
                borderRadius: 8,
                alignItems: 'center',
                opacity: working ? 0.5 : 1,
              }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>
                {working ? 'Saving…' : 'Confirm not available'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
