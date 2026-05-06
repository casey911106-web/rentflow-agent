import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#00A7A5',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: { backgroundColor: '#FFFFFF' },
        headerStyle: { backgroundColor: '#061D3F' },
        headerTintColor: '#FFFFFF',
      }}
    >
      <Tabs.Screen name="today" options={{ title: "Today's viewings" }} />
      <Tabs.Screen name="performance" options={{ title: 'My performance' }} />
      <Tabs.Screen name="notifications" options={{ title: 'Notifications' }} />
    </Tabs>
  );
}
