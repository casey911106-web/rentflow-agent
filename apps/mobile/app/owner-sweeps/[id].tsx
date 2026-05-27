import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../lib/api';

interface SweepItem {
  id: string;
  availability:
    | 'available'
    | 'rented'
    | 'price_changed'
    | 'no_answer'
    | null;
  resolvedAt: string | null;
  sharedAt: string | null;
  faqAllRequired: boolean;
  faqAnswers: Record<string, unknown> | null;
  newPriceAed: string | null;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
    availabilityConfirmedAt: string | null;
    detailsCompletedAt: string | null;
  };
}

interface Sweep {
  id: string;
  status: 'pending' | 'in_progress' | 'closed';
  assignedAt: string | null;
  owner: { id: string; fullName: string | null; phoneE164: string };
  items: SweepItem[];
}

type QuestionType = 'text' | 'number' | 'boolean' | 'enum' | 'multi_enum';

interface DetailQuestion {
  id: string;
  key: string;
  label: string;
  helperText: string | null;
  type: QuestionType;
  options: string[] | null;
  isRequired: boolean;
  position: number;
}

const OUTCOME_LABELS: Record<Exclude<SweepItem['availability'], null>, string> = {
  available: 'Available',
  rented: 'Rented',
  price_changed: 'Price changed',
  no_answer: 'No answer',
};

export default function OwnerSweepDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<DetailQuestion[] | null>(null);
  const [faqModalItem, setFaqModalItem] = useState<SweepItem | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<Sweep>(`/owner-sweeps/${id}`);
      setSweep(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function openFaq(item: SweepItem) {
    if (!questions) {
      try {
        const q = await api<DetailQuestion[]>('/property-details/questions');
        setQuestions(q);
      } catch (err) {
        Alert.alert('Could not load FAQ', (err as Error).message);
        return;
      }
    }
    setFaqModalItem(item);
  }

  async function sendWa(itemId: string) {
    try {
      const res = await api<{ waDeepLink: string; publicUrl: string; prefilledText: string }>(
        `/owner-sweeps/${id}/items/${itemId}/share`,
        { method: 'POST', body: JSON.stringify({ channel: 'whatsapp' }) },
      );
      await Linking.openURL(res.waDeepLink);
      load();
    } catch (err) {
      Alert.alert('Could not open WhatsApp', (err as Error).message);
    }
  }

  async function setAvailability(
    item: SweepItem,
    outcome: Exclude<SweepItem['availability'], null>,
    extra?: { rentedUntil?: string; newPriceAed?: number },
  ) {
    try {
      await api(`/owner-sweeps/${id}/items/${item.id}/availability`, {
        method: 'POST',
        body: JSON.stringify({ outcome, ...extra }),
      });
      load();
    } catch (err) {
      Alert.alert('Could not save', (err as Error).message);
    }
  }

  function promptPrice(item: SweepItem) {
    Alert.prompt(
      'New price (AED)',
      'How much is the new monthly rent?',
      (text) => {
        const num = Number(text);
        if (!Number.isFinite(num) || num <= 0) {
          Alert.alert('Invalid number');
          return;
        }
        setAvailability(item, 'price_changed', { newPriceAed: num });
      },
      'plain-text',
      item.property.priceAed ?? '',
    );
  }

  async function closeSweep() {
    Alert.alert(
      'Close sweep?',
      'Items not marked will be saved as No answer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            try {
              await api(`/owner-sweeps/${id}/close`, { method: 'POST' });
              router.back();
            } catch (err) {
              Alert.alert('Could not close', (err as Error).message);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }
  if (error || !sweep) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ color: '#DC2626' }}>{error ?? 'Sweep not found'}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ backgroundColor: 'white', padding: 14, borderRadius: 12, marginBottom: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F' }}>
            {sweep.owner.fullName ?? sweep.owner.phoneE164}
          </Text>
          <Text style={{ color: '#64748B', fontSize: 13, marginTop: 2 }}>
            {sweep.owner.phoneE164} · {sweep.items.length} properties
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <Pressable
              onPress={() => Linking.openURL(`tel:${sweep.owner.phoneE164}`)}
              style={{ backgroundColor: '#00A7A5', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}
            >
              <Text style={{ color: 'white', fontWeight: '600' }}>📞 Call</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Linking.openURL(
                  `whatsapp://send?phone=${sweep.owner.phoneE164.replace(/[^0-9]/g, '')}`,
                )
              }
              style={{ backgroundColor: '#25D366', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}
            >
              <Text style={{ color: 'white', fontWeight: '600' }}>💬 WhatsApp</Text>
            </Pressable>
          </View>
        </View>

        {/* Items */}
        {sweep.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onSendWa={() => sendWa(item.id)}
            onAvailability={(o) => {
              if (o === 'price_changed') promptPrice(item);
              else setAvailability(item, o);
            }}
            onFaq={() => openFaq(item)}
          />
        ))}

        <Pressable
          onPress={closeSweep}
          style={{
            backgroundColor: '#061D3F',
            padding: 14,
            borderRadius: 12,
            marginTop: 8,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Close sweep</Text>
        </Pressable>
      </ScrollView>

      <FaqModal
        item={faqModalItem}
        questions={questions ?? []}
        onClose={() => setFaqModalItem(null)}
        onSubmit={async (answers) => {
          if (!faqModalItem) return;
          try {
            await api(`/owner-sweeps/${id}/items/${faqModalItem.id}/faq`, {
              method: 'POST',
              body: JSON.stringify({ answers }),
            });
            setFaqModalItem(null);
            load();
          } catch (err) {
            Alert.alert('Could not save FAQ', (err as Error).message);
          }
        }}
      />
    </View>
  );
}

function ItemCard({
  item,
  onSendWa,
  onAvailability,
  onFaq,
}: {
  item: SweepItem;
  onSendWa: () => void;
  onAvailability: (o: Exclude<SweepItem['availability'], null>) => void;
  onFaq: () => void;
}) {
  return (
    <View style={{ backgroundColor: 'white', padding: 14, borderRadius: 12, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: '#061D3F' }}>{item.property.code}</Text>
        {item.property.priceAed ? (
          <Text style={{ color: '#64748B', fontSize: 13 }}>AED {item.property.priceAed}</Text>
        ) : null}
      </View>
      <Text style={{ color: '#475569', fontSize: 13 }}>{item.property.name}</Text>
      {item.property.area ? (
        <Text style={{ color: '#94A3B8', fontSize: 12 }}>{item.property.area}</Text>
      ) : null}

      <Pressable
        onPress={onSendWa}
        style={{
          backgroundColor: '#25D366',
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 6,
          alignSelf: 'flex-start',
          marginTop: 8,
        }}
      >
        <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>
          📤 {item.sharedAt ? 'Re-send WA link' : 'Send WA link'}
        </Text>
      </Pressable>

      <Text style={{ marginTop: 12, color: '#64748B', fontSize: 12, fontWeight: '600' }}>
        Availability
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {(['available', 'rented', 'price_changed', 'no_answer'] as const).map((o) => {
          const active = item.availability === o;
          return (
            <Pressable
              key={o}
              onPress={() => onAvailability(o)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                backgroundColor: active ? '#00A7A5' : '#F1F5F9',
              }}
            >
              <Text style={{ color: active ? 'white' : '#475569', fontSize: 12, fontWeight: '600' }}>
                {OUTCOME_LABELS[o]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={onFaq}
        style={{
          marginTop: 12,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: item.faqAllRequired ? '#10B981' : '#CBD5E1',
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: '#061D3F', fontSize: 12, fontWeight: '600' }}>
          {item.faqAllRequired ? '✓ FAQ filled' : 'Fill FAQ'}
        </Text>
      </Pressable>
    </View>
  );
}

function FaqModal({
  item,
  questions,
  onClose,
  onSubmit,
}: {
  item: SweepItem | null;
  questions: DetailQuestion[];
  onClose: () => void;
  onSubmit: (answers: Record<string, unknown>) => void | Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setAnswers((item?.faqAnswers as Record<string, unknown> | null) ?? {});
  }, [item]);

  if (!item) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            padding: 16,
            backgroundColor: '#061D3F',
          }}
        >
          <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
            FAQ — {item.property.code}
          </Text>
          <Pressable onPress={onClose}>
            <Text style={{ color: 'white' }}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {questions.map((q) => (
            <View key={q.key} style={{ marginBottom: 14 }}>
              <Text style={{ color: '#061D3F', fontWeight: '600' }}>
                {q.label} {q.isRequired ? '*' : ''}
              </Text>
              {q.helperText ? (
                <Text style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>{q.helperText}</Text>
              ) : null}
              {q.type === 'text' || q.type === 'number' ? (
                <TextInput
                  keyboardType={q.type === 'number' ? 'numeric' : 'default'}
                  value={String(answers[q.key] ?? '')}
                  onChangeText={(v) =>
                    setAnswers((a) => ({
                      ...a,
                      [q.key]: q.type === 'number' ? (v === '' ? undefined : Number(v)) : v,
                    }))
                  }
                  style={{
                    backgroundColor: 'white',
                    borderWidth: 1,
                    borderColor: '#CBD5E1',
                    borderRadius: 6,
                    padding: 8,
                  }}
                />
              ) : q.type === 'boolean' ? (
                <Switch
                  value={Boolean(answers[q.key])}
                  onValueChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
                />
              ) : q.type === 'enum' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {(q.options ?? []).map((opt) => {
                    const active = answers[q.key] === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setAnswers((a) => ({ ...a, [q.key]: opt }))}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          backgroundColor: active ? '#00A7A5' : '#F1F5F9',
                        }}
                      >
                        <Text style={{ color: active ? 'white' : '#475569', fontSize: 12 }}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : q.type === 'multi_enum' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {(q.options ?? []).map((opt) => {
                    const current = (answers[q.key] as string[]) ?? [];
                    const active = current.includes(opt);
                    return (
                      <Pressable
                        key={opt}
                        onPress={() =>
                          setAnswers((a) => {
                            const arr = (a[q.key] as string[]) ?? [];
                            const next = arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt];
                            return { ...a, [q.key]: next };
                          })
                        }
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          backgroundColor: active ? '#00A7A5' : '#F1F5F9',
                        }}
                      >
                        <Text style={{ color: active ? 'white' : '#475569', fontSize: 12 }}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ))}
          <Pressable
            onPress={() => onSubmit(answers)}
            style={{
              backgroundColor: '#00A7A5',
              padding: 12,
              borderRadius: 8,
              marginTop: 8,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
