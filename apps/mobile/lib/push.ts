import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Registers this device's Expo push token against the logged-in user's
 * profile in the API. Idempotent — safe to call on every app boot.
 *
 * Returns the token (or null if registration failed). Failures are
 * non-blocking — the app keeps working, the user just won't get pushes.
 */
export async function registerPushTokenIfPossible(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      // Push only works on real hardware. iOS simulator + Android emulator
      // can't receive remote notifications.
      return null;
    }

    // Foreground display config — let banners + sounds show even when the
    // app is open, otherwise users wonder where the push went.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // Android needs explicit notification channels (sound, importance,
    // light, vibration) to render at all.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0F172A',
      });
      await Notifications.setNotificationChannelAsync('viewings', {
        name: 'Viewings',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#00A7A5',
      });
      await Notifications.setNotificationChannelAsync('tasks', {
        name: 'Publishing tasks',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#00A7A5',
      });
      await Notifications.setNotificationChannelAsync('leads', {
        name: 'Lead replies',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 200, 250],
        lightColor: '#00A7A5',
      });
    }

    // Permission. Asks once on iOS — afterwards iOS remembers the choice
    // (user can change it from Settings).
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (existing.status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      return null;
    }

    // Get the Expo push token. Needs the projectId from app.json so it
    // routes through this app's push credentials, not Expo Go's.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) {
      console.warn('[push] no projectId in app.json — cannot get Expo push token');
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    if (!token) return null;

    // Send it to the API. The endpoint is idempotent — safe to call on every boot.
    try {
      await api('/notifications/push-token', {
        method: 'PUT',
        body: JSON.stringify({ token, platform: Platform.OS as 'ios' | 'android' }),
      });
    } catch (err) {
      // Most common reason: not logged in. That's fine — try again after login.
      console.warn('[push] failed to register token with API:', (err as Error).message);
      return token;
    }

    return token;
  } catch (err) {
    console.warn('[push] registration failed:', (err as Error).message);
    return null;
  }
}

/**
 * Unregisters the device's push token from the API. Called on logout.
 * Best-effort — never throws.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    if (!token) return;
    await api('/notifications/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    });
  } catch {
    // swallow
  }
}
