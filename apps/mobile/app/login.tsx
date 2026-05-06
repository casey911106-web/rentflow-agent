import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, setToken } from '../lib/api';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('agent1@rentflow.demo');
  const [password, setPassword] = useState('rentflow123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogin() {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
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
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#F8FAFC' }}>
      <Text style={{ fontSize: 28, fontWeight: '700', color: '#061D3F', marginBottom: 4 }}>
        RentFlow Agent
      </Text>
      <Text style={{ color: '#64748B', marginBottom: 24 }}>Field-agent app</Text>

      <Text style={{ fontWeight: '600', color: '#334155', marginBottom: 4 }}>Email</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{
          backgroundColor: 'white',
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          marginBottom: 16,
        }}
      />

      <Text style={{ fontWeight: '600', color: '#334155', marginBottom: 4 }}>Password</Text>
      <TextInput
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          backgroundColor: 'white',
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          marginBottom: 16,
        }}
      />

      {error ? <Text style={{ color: '#DC2626', marginBottom: 12 }}>{error}</Text> : null}

      <Pressable
        onPress={onLogin}
        disabled={loading}
        style={{
          backgroundColor: '#00A7A5',
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? <ActivityIndicator color="white" /> : (
          <Text style={{ color: 'white', fontWeight: '600' }}>Sign in</Text>
        )}
      </Pressable>
    </View>
  );
}
