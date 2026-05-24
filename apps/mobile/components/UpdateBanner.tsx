import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Subtle update indicator. Shows a tiny teal pill near the top of the screen
 * once an OTA update has been downloaded and is waiting to be applied. The
 * user can tap to expand + reload. Hidden otherwise — never blocks the UI.
 *
 * The actual download happens in app/_layout.tsx on every launch; this
 * component just surfaces the "ready to apply" state and the reload action.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (__DEV__) return; // expo-updates is a no-op in dev builds.

    let timer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    async function poll() {
      try {
        const state = await Updates.checkForUpdateAsync();
        if (!active) return;
        if (state.isAvailable) {
          await Updates.fetchUpdateAsync();
          if (active) setReady(true);
        }
      } catch {
        // ignore
      }
    }

    // Check shortly after mount (covers updates fetched during the first
    // launch by the root layout) and then every 10 minutes while open.
    const initial = setTimeout(poll, 4000);
    timer = setInterval(poll, 10 * 60 * 1000);

    return () => {
      active = false;
      clearTimeout(initial);
      if (timer) clearInterval(timer);
    };
  }, []);

  if (!ready) return null;

  async function reload() {
    if (reloading) return;
    setReloading(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setReloading(false);
    }
  }

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 9999,
      }}
    >
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        style={{
          marginTop: 6,
          paddingHorizontal: expanded ? 14 : 10,
          paddingVertical: expanded ? 8 : 4,
          backgroundColor: '#00A7A5',
          borderRadius: 999,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 4,
          elevation: 3,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' }} />
        {expanded ? (
          <>
            <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>
              Update lista — reiniciar para aplicar
            </Text>
            <Pressable
              onPress={reload}
              disabled={reloading}
              hitSlop={6}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: 999,
              }}
            >
              <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>
                {reloading ? '...' : 'Reiniciar'}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={{ color: 'white', fontSize: 11, fontWeight: '600' }}>
            Update
          </Text>
        )}
      </Pressable>
    </View>
  );
}
