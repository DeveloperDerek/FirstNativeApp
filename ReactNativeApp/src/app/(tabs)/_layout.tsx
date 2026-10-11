import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import AppTabs from '@/components/app-tabs';
import { StepsProvider } from '@/hooks/use-steps';

export default function TabLayout() {
  useConsentPromptOnce();
  return (
    <StepsProvider>
      <AppTabs />
    </StepsProvider>
  );
}

/**
 * After the first sign-in, ask once whether to share steps (section 14c).
 * If they choose "Not now", Friends and Groups offer it again later.
 */
function useConsentPromptOnce() {
  const router = useRouter();
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile || profile.sharing_consent_at) return;
    const key = `consent-prompted:${profile.id}`;
    AsyncStorage.getItem(key)
      .then(async (prompted) => {
        if (prompted) return;
        await AsyncStorage.setItem(key, '1');
        router.push('/consent');
      })
      .catch(() => {});
  }, [profile, router]);
}
