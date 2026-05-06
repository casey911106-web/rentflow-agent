import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from '../../lib/api';

interface Me {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export default function PerformanceScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00A7A5" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      <View
        style={{
          backgroundColor: 'white',
          padding: 16,
          borderRadius: 12,
          marginBottom: 12,
        }}
      >
        <Text style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase' }}>
          Signed in as
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#061D3F', marginTop: 4 }}>
          {me?.fullName ?? '—'}
        </Text>
        <Text style={{ color: '#64748B' }}>{me?.email}</Text>
      </View>

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#061D3F', marginBottom: 12 }}>
          Performance
        </Text>
        <Text style={{ color: '#64748B' }}>
          Detailed performance breakdown will appear here after a few completed viewings.
        </Text>
      </View>
    </View>
  );
}
