import { Stack } from 'expo-router';

import { useMapTheme } from '@/hooks/use-map-theme';

export default function GroupsLayout() {
  const { theme } = useMapTheme();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* The header is painted the map's sky so it runs into the page's own sky */}
      <Stack.Screen
        name="[id]"
        options={{
          title: '',
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: theme.sky },
          headerTintColor: theme.skyInk,
          headerShadowVisible: false,
        }}
      />
    </Stack>
  );
}
