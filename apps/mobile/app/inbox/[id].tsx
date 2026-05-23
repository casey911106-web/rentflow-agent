import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../lib/api';

interface WAMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  body: string | null;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  leadPhoneE164: string;
  mode: string;
  messages: WAMessage[];
  lead: {
    id: string;
    fullName: string | null;
    status: string;
    propertyId: string | null;
    property: { code: string; name: string } | null;
  } | null;
}

interface PendingSuggestion {
  id: string;
  state: string;
  suggestedReply: string;
  confidence: number | null;
  conversation: { id: string };
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [pending, setPending] = useState<PendingSuggestion | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'send' | 'takeover' | 'release' | 'approve' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, all] = await Promise.all([
        api<ConversationDetail>(`/whatsapp/conversations/${id}`),
        api<PendingSuggestion[]>('/suggestions?status=pending').catch(() => []),
      ]);
      setConv(c);
      setPending(all.find((s) => s.conversation.id === id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollToEnd({ animated: false });
  }, [conv?.messages.length]);

  const isHuman = conv?.mode === 'human_takeover';

  async function takeover() {
    if (!id) return;
    setBusy('takeover');
    try { await api(`/whatsapp/conversations/${id}/human-takeover`, { method: 'POST' }); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function release() {
    if (!id) return;
    setBusy('release');
    try { await api(`/whatsapp/conversations/${id}/release-to-ai`, { method: 'POST' }); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function send() {
    if (!id || !draft.trim()) return;
    setBusy('send');
    try {
      await api(`/whatsapp/conversations/${id}/send`, { method: 'POST', body: JSON.stringify({ text: draft }) });
      setDraft('');
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function approveSuggestion() {
    if (!pending) return;
    setBusy('approve');
    try { await api(`/suggestions/${pending.id}/approve`, { method: 'POST' }); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function cancelSuggestion() {
    if (!pending) return;
    setBusy('cancel');
    try { await api(`/suggestions/${pending.id}/cancel`, { method: 'POST' }); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!conv) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F9FC' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F7F9FC' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          title: conv.lead?.fullName ?? conv.leadPhoneE164,
        }}
      />

      <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Courier', fontSize: 11, color: '#64748B' }}>{conv.leadPhoneE164}</Text>
            {conv.lead?.property ? (
              <Text style={{ fontSize: 12, color: '#082B5F', marginTop: 2 }}>
                {conv.lead.property.code} · {conv.lead.property.name}
              </Text>
            ) : null}
          </View>
          {isHuman ? (
            <Pressable
              onPress={release}
              disabled={busy === 'release'}
              style={{ backgroundColor: '#00A7A5', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>{busy === 'release' ? '...' : 'Devolver a IA'}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={takeover}
              disabled={busy === 'takeover'}
              style={{ borderColor: '#00A7A5', borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Text style={{ color: '#00A7A5', fontSize: 12, fontWeight: '600' }}>{busy === 'takeover' ? '...' : 'Tomar manual'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 12, gap: 6 }} style={{ flex: 1 }}>
        {conv.messages.map((m) => (
          <View
            key={m.id}
            style={{
              alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              backgroundColor: m.direction === 'outbound' ? '#00A7A5' : '#FFFFFF',
              padding: 10,
              borderRadius: 12,
              shadowColor: '#000',
              shadowOpacity: 0.05,
              shadowRadius: 2,
            }}
          >
            <Text style={{ color: m.direction === 'outbound' ? 'white' : '#0F172A', fontSize: 14 }}>
              {m.body ?? `(${m.type})`}
            </Text>
            <Text style={{ color: m.direction === 'outbound' ? 'rgba(255,255,255,0.7)' : '#94A3B8', fontSize: 10, marginTop: 4 }}>
              {new Date(m.createdAt).toLocaleString()}
            </Text>
          </View>
        ))}
      </ScrollView>

      {pending && !isHuman ? (
        <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: '#FDE68A' }}>
          <Text style={{ color: '#B45309', fontSize: 11, fontWeight: '700', marginBottom: 4 }}>● Sugerencia IA pendiente</Text>
          <Text style={{ color: '#0F172A', fontSize: 14, marginBottom: 8 }}>{pending.suggestedReply}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={approveSuggestion}
              disabled={busy === 'approve'}
              style={{ backgroundColor: '#00A7A5', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>{busy === 'approve' ? 'Enviando...' : 'Aprobar'}</Text>
            </Pressable>
            <Pressable
              onPress={cancelSuggestion}
              disabled={busy === 'cancel'}
              style={{ borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: 'white', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: '#475569', fontSize: 12, fontWeight: '600' }}>Descartar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: '#E5E7EB' }}>
        {!isHuman ? (
          <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
            La IA responde. Tomá manual para escribir.
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            editable={isHuman && busy !== 'send'}
            multiline
            placeholder={isHuman ? 'Escribí un mensaje…' : 'Tomá manual para escribir.'}
            placeholderTextColor="#94A3B8"
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 120,
              backgroundColor: isHuman ? '#FFFFFF' : '#F1F5F9',
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              color: '#0F172A',
              fontSize: 14,
            }}
          />
          <Pressable
            onPress={send}
            disabled={!isHuman || !draft.trim() || busy === 'send'}
            style={{
              backgroundColor: !isHuman || !draft.trim() ? '#94A3B8' : '#00A7A5',
              borderRadius: 8,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: 'white', fontSize: 13, fontWeight: '600' }}>{busy === 'send' ? '...' : 'Enviar'}</Text>
          </Pressable>
        </View>
        {error ? <Text style={{ color: '#DC2626', fontSize: 11, marginTop: 4 }}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}
