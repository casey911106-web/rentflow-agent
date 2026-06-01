import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Updates from 'expo-updates';

type State = 'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error';

/**
 * Update indicator + manual pull.
 *
 * Two surfaces in one component:
 *  (1) Auto-pill: when a background poll has finished downloading an update,
 *      a teal pill appears top-center. Tap → expand → Reiniciar.
 *  (2) Hidden tap-dot: a near-invisible 8×8 dot in the top-right corner.
 *      Tap = "check + fetch + reload now" without waiting for the 10-min
 *      poll or relaunching the app. Used to push an EAS update to the
 *      device on demand. Visible feedback only while actively working.
 *
 * Background polling: shortly after mount, then every 10 min.
 */
export function UpdateBanner() {
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (__DEV__) return; // expo-updates is a no-op in dev builds.

    let timer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    async function poll() {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!active) return;
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          if (active) setState('ready');
        }
      } catch {
        // ignore
      }
    }

    const initial = setTimeout(poll, 4000);
    timer = setInterval(poll, 10 * 60 * 1000);

    return () => {
      active = false;
      clearTimeout(initial);
      if (timer) clearInterval(timer);
    };
  }, []);

  async function manualPull() {
    if (state === 'checking' || state === 'downloading') return;
    if (__DEV__) {
      // In dev expo-updates is a no-op; show a brief "uptodate" so the
      // tap target is testable without a real EAS channel.
      setState('uptodate');
      setTimeout(() => setState('idle'), 1500);
      return;
    }
    try {
      setState('checking');
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setState('uptodate');
        setTimeout(() => setState('idle'), 1800);
        return;
      }
      setState('downloading');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
      // reloadAsync replaces the JS bundle; nothing after this runs.
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 1800);
    }
  }

  async function reload() {
    try {
      await Updates.reloadAsync();
    } catch {
      // swallow — user can tap again
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
        zIndex: 9999,
      }}
    >
      {/* (1) Auto-pill — only when an update is staged */}
      {state === 'ready' ? <ReadyPill onReload={reload} /> : null}

      {/* (2) Hidden tap-dot — always present in top-right corner */}
      <Pressable
        onPress={manualPull}
        hitSlop={20}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 14,
          height: 14,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {state === 'idle' || state === 'ready' ? (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: '#00A7A5',
              opacity: 0.18,
            }}
          />
        ) : state === 'checking' || state === 'downloading' ? (
          <ActivityIndicator size="small" color="#00A7A5" />
        ) : (
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: state === 'uptodate' ? '#16A34A' : '#DC2626',
            }}
          >
            <Text style={{ color: 'white', fontSize: 9, fontWeight: '700' }}>
              {state === 'uptodate' ? '✓' : '!'}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function ReadyPill({ onReload }: { onReload: () => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [reloading, setReloading] = useState(false);
  return (
    <View style={{ alignItems: 'center' }}>
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
              onPress={async () => {
                if (reloading) return;
                setReloading(true);
                await onReload();
              }}
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
