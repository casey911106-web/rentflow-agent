import { useEffect, useMemo, useState } from 'react';
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

interface Question {
  id: string;
  key: string;
  label: string;
  helperText: string | null;
  type: 'text' | 'number' | 'boolean' | 'enum' | 'multi_enum';
  options: string[] | null;
  isRequired: boolean;
  position: number;
}

interface PropertyPhoto {
  id: string;
  file: { id: string; mimeType: string };
}

interface Task {
  id: string;
  expiresAt: string;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
    type: string;
    details: Record<string, unknown> | null;
    media: PropertyPhoto[];
    owner: { id: string; fullName: string | null; phoneE164: string } | null;
  };
}

export default function PropertyDetailsFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Task[]>('/property-details/my'),
      api<Question[]>('/property-details/questions'),
    ])
      .then(([tasks, qs]) => {
        if (!active) return;
        const found = tasks.find((t) => t.id === id);
        if (!found) {
          setError('This task is no longer assigned to you or has expired.');
        } else {
          setTask(found);
          setAnswers({ ...((found.property.details as Record<string, unknown>) ?? {}) });
        }
        setQuestions(qs);
      })
      .catch((err) => active && setError((err as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  const missingRequired = useMemo(
    () =>
      questions
        .filter((q) => q.isRequired)
        .filter((q) => !isPresent(answers[q.key]))
        .map((q) => q.label),
    [questions, answers],
  );

  async function submit() {
    if (submitting) return;
    if (missingRequired.length > 0) {
      Alert.alert(
        'Missing answers',
        `Please fill: ${missingRequired.slice(0, 3).join(', ')}${missingRequired.length > 3 ? '…' : ''}`,
      );
      return;
    }
    setSubmitting(true);
    try {
      await api(`/property-details/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
      Alert.alert('Saved', 'Details recorded. The AI can now answer guest questions about this property.');
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function savePhotos() {
    if (!task || downloading) return;
    const photos = task.property.media ?? [];
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
        const localPath = `${FileSystem.cacheDirectory}${task.property.code}-${i + 1}.${ext}`;
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
        ? `${saved} photo${saved > 1 ? 's' : ''} saved to your camera roll. Open WhatsApp and attach them so the owner knows which unit.`
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

  if (error || !task) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: '#DC2626', textAlign: 'center' }}>{error ?? 'Task not found'}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#00A7A5', fontWeight: '600' }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const owner = task.property.owner;
  const photos = task.property.media ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8FAFC' }} contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: 'Property details' }} />

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#64748B' }}>Property</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F', marginTop: 2 }}>
          {task.property.code}
        </Text>
        <Text style={{ color: '#475569', marginTop: 2 }}>{task.property.name}</Text>
        {task.property.area ? (
          <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 2 }}>{task.property.area}</Text>
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

      {owner ? (
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: '#64748B' }}>Contact the owner</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#061D3F', marginTop: 2 }}>
            {owner.fullName ?? '(no name)'}
          </Text>
          <Text style={{ color: '#475569', marginTop: 2 }}>{owner.phoneE164}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable
              onPress={() => Linking.openURL(`tel:${owner.phoneE164}`)}
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
              onPress={() => Linking.openURL(`https://wa.me/${owner.phoneE164.replace('+', '')}`)}
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
      ) : null}

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#061D3F', marginBottom: 4 }}>
          Questions for the owner
        </Text>
        <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
          Fill in what you know. Fields marked * are required to close the task.
        </Text>

        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.key]}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v }))}
          />
        ))}
      </View>

      <Pressable
        onPress={submit}
        disabled={submitting}
        style={{
          backgroundColor: '#16A34A',
          padding: 16,
          borderRadius: 12,
          alignItems: 'center',
          opacity: submitting ? 0.5 : 1,
        }}
      >
        <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>
          {submitting ? 'Saving…' : 'Save and close task'}
        </Text>
      </Pressable>
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, color: '#061D3F', fontWeight: '600' }}>
        {question.label}{question.isRequired ? ' *' : ''}
      </Text>
      {question.helperText ? (
        <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, marginBottom: 6 }}>
          {question.helperText}
        </Text>
      ) : (
        <View style={{ height: 6 }} />
      )}
      <FieldInput question={question} value={value} onChange={onChange} />
    </View>
  );
}

function FieldInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (question.type) {
    case 'text':
      return (
        <TextInput
          value={(value as string) ?? ''}
          onChangeText={onChange}
          placeholderTextColor="#94A3B8"
          style={inputStyle}
        />
      );
    case 'number':
      return (
        <TextInput
          value={value == null ? '' : String(value)}
          onChangeText={(t) => onChange(t === '' ? undefined : Number(t.replace(',', '.')))}
          keyboardType="numeric"
          placeholderTextColor="#94A3B8"
          style={inputStyle}
        />
      );
    case 'boolean':
      return (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { label: 'Yes', val: true },
            { label: 'No', val: false },
          ].map((opt) => {
            const selected = value === opt.val;
            return (
              <Pressable
                key={opt.label}
                onPress={() => onChange(opt.val)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  alignItems: 'center',
                  backgroundColor: selected ? '#00A7A5' : '#F1F5F9',
                }}
              >
                <Text style={{ color: selected ? 'white' : '#475569', fontWeight: '600' }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    case 'enum': {
      const opts = question.options ?? [];
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {opts.map((opt) => {
            const selected = value === opt;
            return (
              <Pressable
                key={opt}
                onPress={() => onChange(opt)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 16,
                  backgroundColor: selected ? '#00A7A5' : '#F1F5F9',
                }}
              >
                <Text style={{ color: selected ? 'white' : '#475569', fontWeight: '600', fontSize: 13 }}>
                  {opt}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case 'multi_enum': {
      const opts = question.options ?? [];
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {opts.map((opt) => {
            const selected = arr.includes(opt);
            return (
              <Pressable
                key={opt}
                onPress={() =>
                  onChange(selected ? arr.filter((v) => v !== opt) : [...arr, opt])
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 16,
                  backgroundColor: selected ? '#00A7A5' : '#F1F5F9',
                }}
              >
                <Text style={{ color: selected ? 'white' : '#475569', fontWeight: '600', fontSize: 13 }}>
                  {opt}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    default:
      return null;
  }
}

const inputStyle = {
  backgroundColor: '#F8FAFC',
  padding: 10,
  borderRadius: 8,
  fontSize: 14,
  color: '#061D3F',
};

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
