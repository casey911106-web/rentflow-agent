import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/**
 * Resolve the API base URL.
 *
 * Priority:
 *   1. EXPO_PUBLIC_API_URL env (set explicitly).
 *   2. expo.extra.apiUrl from app.json.
 *   3. Auto-detected LAN host from the Expo dev server (so a phone on the
 *      same WiFi can reach the Mac at e.g. http://192.168.1.50:3001 instead
 *      of localhost — which on the phone refers to the phone itself).
 *   4. http://localhost:3001 as last resort (works on simulator / web).
 */
function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

  const extraApi = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  if (extraApi) return extraApi;

  // Expo Go in dev: hostUri = "192.168.1.50:8081"
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } })
      .manifest2?.extra?.expoGo?.debuggerHost;
  const ip = hostUri?.split(':')[0];
  if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
    return `http://${ip}:3001`;
  }

  return 'http://localhost:3001';
}

const API_BASE = resolveApiBase();
// eslint-disable-next-line no-console
console.log('[rentflow] API base:', API_BASE);

const TOKEN_KEY = 'rentflow_token';

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Upload a local file (file:// URI) as multipart/form-data. */
export async function uploadFile<T = unknown>(
  path: string,
  uri: string,
  fileName: string,
  mimeType: string,
  extraFields: Record<string, string> = {},
): Promise<T> {
  const token = await getToken();
  const formData = new FormData();
  formData.append(
    'file',
    { uri, name: fileName, type: mimeType } as unknown as Blob,
  );
  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
