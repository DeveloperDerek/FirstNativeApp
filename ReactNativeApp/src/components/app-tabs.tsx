import { NativeTabs } from 'expo-router/native-tabs';

import { useMapTheme } from '@/hooks/use-map-theme';

// The tab bar is the map's ground color, so the ground runs all the way
// down. (On iOS 26 and later the system draws the bar and ignores it.)
export default function AppTabs() {
  const { theme } = useMapTheme();
  const faded = theme.ink + '99'; // same color, faded

  return (
    <NativeTabs
      backgroundColor={theme.ground}
      indicatorColor={theme.button}
      iconColor={{ default: faded, selected: theme.ink }}
      labelStyle={{ default: { color: faded }, selected: { color: theme.ink } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="friends">
        <NativeTabs.Trigger.Label>Friends</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2" md="group" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="groups">
        <NativeTabs.Trigger.Label>Groups</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="trophy" md="trophy" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
