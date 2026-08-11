import { StyleSheet, Text, View } from 'react-native'

import { useSyncStatus } from '../data/SyncProvider'
import type { SyncStatus } from '../data/syncCoordinator'

type SyncStatusBannerProps = {
  status?: SyncStatus
}

const statusMessage = (status: SyncStatus): string => {
  switch (status.state) {
    case 'offline':
      return status.pending === 1
        ? 'Offline · 1 change waiting'
        : `Offline · ${status.pending} changes waiting`
    case 'syncing':
      return status.pending === 1
        ? 'Syncing 1 change…'
        : `Syncing ${status.pending} changes…`
    case 'failed':
      return status.pending === 1
        ? 'Sync paused · 1 change waiting'
        : `Sync paused · ${status.pending} changes waiting`
    case 'conflict':
      return status.count === 1 ? '1 conflict needs review' : `${status.count} conflicts need review`
    case 'current':
      return 'Up to date'
  }
}

const Banner = ({ status }: { status: SyncStatus }) => (
  <View
    accessibilityLiveRegion="polite"
    style={[
      styles.banner,
      status.state === 'failed' || status.state === 'conflict' ? styles.attention : styles.normal,
    ]}
    testID="sync-status-banner"
  >
    <Text style={styles.text}>{statusMessage(status)}</Text>
  </View>
)

const ConnectedBanner = () => <Banner status={useSyncStatus()} />

export const SyncStatusBanner = ({ status }: SyncStatusBannerProps) =>
  status ? <Banner status={status} /> : <ConnectedBanner />

const styles = StyleSheet.create({
  banner: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  normal: { backgroundColor: '#E2E8F0' },
  attention: { backgroundColor: '#FEF3C7' },
  text: { color: '#0F172A', fontSize: 14, fontWeight: '600' },
})
