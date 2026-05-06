import { Text, View } from 'react-native';

export default function NotificationsScreen() {
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#061D3F', marginBottom: 6 }}>
          Notifications
        </Text>
        <Text style={{ color: '#64748B' }}>You're all caught up.</Text>
      </View>
    </View>
  );
}
