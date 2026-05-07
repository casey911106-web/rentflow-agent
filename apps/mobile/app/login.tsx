import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api, setToken } from '../lib/api';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  async function onLogin() {
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      await setToken(result.accessToken);
      router.replace('/(tabs)/today');
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F8FAFC' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <Image
              source={require('../assets/icon.png')}
              style={{ width: 96, height: 96, marginBottom: 12 }}
              resizeMode="contain"
            />
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#061D3F' }}>RentFlow Agent</Text>
            <Text style={{ color: '#64748B', marginTop: 4 }}>Field-agent app</Text>
          </View>

          <Text style={{ fontWeight: '600', color: '#334155', marginBottom: 6 }}>Email</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            blurOnSubmit={false}
            style={inputStyle}
            placeholder="you@example.com"
            placeholderTextColor="#94A3B8"
          />

          <Text style={{ fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 16 }}>
            Password
          </Text>
          <TextInput
            ref={passwordRef}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            returnKeyType="go"
            onSubmitEditing={onLogin}
            style={inputStyle}
            placeholder="••••••••"
            placeholderTextColor="#94A3B8"
          />

          {error ? <Text style={{ color: '#DC2626', marginTop: 12 }}>{error}</Text> : null}

          <Pressable
            onPress={onLogin}
            disabled={loading}
            style={{
              backgroundColor: '#00A7A5',
              padding: 14,
              borderRadius: 10,
              alignItems: 'center',
              marginTop: 24,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: 'white', fontWeight: '600', fontSize: 15 }}>Sign in</Text>
            )}
          </Pressable>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  backgroundColor: 'white',
  padding: 14,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  fontSize: 15,
  color: '#0F172A',
} as const;
