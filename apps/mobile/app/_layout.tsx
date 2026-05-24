import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { UpdateBanner } from '../components/UpdateBanner';

export default function RootLayout() {
  // Background OTA check on every launch. Updates that finish downloading
  // get applied automatically on the next app launch — no UI prompt
  // needed for our flow. Errors are silently ignored so a bad update
  // server never blocks the app from opening.
  useEffect(() => {
    if (__DEV__) return; // expo-updates is a no-op in dev builds anyway
    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          // Don't reload immediately — let the user finish what they're
          // doing. The bundle is staged; next launch picks it up.
        }
      } catch {
        // network issue, no update server, etc. — ignore.
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#061D3F' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#F8FAFC' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'RentFlow Agent' }} />
        <Stack.Screen name="login" options={{ title: 'Sign in' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="viewing/[id]" options={{ title: 'Viewing' }} />
      </Stack>
      <UpdateBanner />
    </View>
  );
}
