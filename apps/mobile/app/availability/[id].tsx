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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../lib/api';

interface CheckDetail {
  id: string;
  expiresAt: string;
  property: { id: string; code: string; name: string; area: string | null; priceAed: string | null };
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

  useEffect(() => {
    let active = true;
    api<CheckDetail[]>('/availability-checks/my')
      .then((items) => {
        if (!active) return;
        const found = items.find((c) => c.id === id);
        if (!found) setError('Este check ya no está asignado a ti o expiró.');
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
      Alert.alert('Confirmado', 'Marcada como disponible. Siguiente check en 7 días.');
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
        'Pausada',
        'Marcada como no disponible. La rotación de publicaciones se pausó para esta propiedad.',
      );
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setWorking(false);
    }
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
        <Text style={{ color: '#DC2626', textAlign: 'center' }}>{error ?? 'Check no encontrado'}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#00A7A5', fontWeight: '600' }}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8FAFC' }} contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: 'Confirmar disponibilidad' }} />

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#64748B' }}>Propiedad</Text>
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

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#64748B' }}>Contactar al dueño</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#061D3F', marginTop: 2 }}>
          {check.owner.fullName ?? '(sin nombre)'}
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
            <Text style={{ color: 'white', fontWeight: '600' }}>Llamar</Text>
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
              ✅ Sigue disponible
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
              ❌ No disponible
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#061D3F', marginBottom: 8 }}>
            Marcar como no disponible
          </Text>
          <Text style={{ color: '#64748B', fontSize: 12, marginBottom: 12 }}>
            La rotación de publicaciones se pausa inmediatamente. Si el dueño dijo cuándo vuelve
            a estar libre, anótalo abajo (es opcional).
          </Text>

          <Text style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
            Vuelve a estar libre (YYYY-MM-DD)
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

          <Text style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Notas (opcional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Ej: ya alquilada, owner no contesta, etc."
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
              <Text style={{ color: '#475569', fontWeight: '600' }}>Atrás</Text>
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
                {working ? 'Guardando…' : 'Confirmar no disponible'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
