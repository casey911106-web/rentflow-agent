import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, clearToken, getToken } from '../lib/api';

export default function IndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) {
        router.replace('/login');
        return;
      }
      // Validate the stored token. Stale tokens (e.g. signed by an old
      // JWT_SECRET from local dev) are silently cleared so the user can
      // log in again instead of bouncing into a 401 wall.
      try {
        await api('/auth/me');
        router.replace('/(tabs)/today');
      } catch {
        await clearToken();
        router.replace('/login');
      }
    })();
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
      <ActivityIndicator color="#00A7A5" />
    </View>
  );
}
