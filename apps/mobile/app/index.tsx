import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '../lib/api';

export default function IndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const t = await getToken();
      router.replace(t ? '/(tabs)/today' : '/login');
    })();
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
      <ActivityIndicator color="#00A7A5" />
    </View>
  );
}
