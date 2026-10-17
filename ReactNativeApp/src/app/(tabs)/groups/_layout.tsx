import { Stack } from 'expo-router';

import { useMapTheme } from '@/hooks/use-map-theme';

export default function GroupsLayout() {
  const { theme } = useMapTheme();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* See-through header: the page's sky picture runs up behind it, as on the tabs */}
      <Stack.Screen
        name="[id]"
        options={{
          title: '',
          headerBackButtonDisplayMode: 'minimal',
          headerTransparent: true,
          headerTintColor: theme.skyInk,
        }}
      />
    </Stack>
  );
}
