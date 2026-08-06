import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { JobRow } from '../../src/components/JobRow'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { VirtualizedEntityList } from '../../src/components/VirtualizedEntityList'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Job, JobStatus } from '../../src/domain/entities'
import { filterJobs } from '../../src/features/jobs/jobForm'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

export default function JobsScreen() {
  const { repository } = useFieldCraftData()
  const [jobs, setJobs] = useState<Job[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<JobStatus | 'All'>('All')
  const load = useCallback(() => { void repository.list<Job>('job').then(setJobs) }, [repository])
  useEffect(() => {
    load()
    return repository.subscribeToLocalMutations(load)
  }, [load, repository])
  const filtered = filterJobs(jobs, query, status)
  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>Jobs</Text>
        <PrimaryButton label="Add" onPress={() => router.push('/jobs/new')} />
      </View>
      <TextInput accessibilityLabel="Search jobs" onChangeText={setQuery} placeholder="Search job titles" placeholderTextColor={colors.muted} style={styles.search} value={query} />
      <View style={styles.filters}>{(['All', 'Scheduled', 'In Progress', 'Invoiced', 'Paid'] as const).map((item) => (
        <Pressable accessibilityRole="button" key={item} onPress={() => setStatus(item)} style={[styles.filter, status === item && styles.selectedFilter]}>
          <Text style={styles.filterText}>{item}</Text>
        </Pressable>
      ))}</View>
      <VirtualizedEntityList
        data={filtered}
        emptyMessage={jobs.length === 0 ? 'No jobs yet. Add the first job to this device.' : 'No jobs match this search and filter.'}
        renderItem={({ item }) => <JobRow job={item} onPress={() => router.push(`/jobs/${item.id}`)} />}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  filter: { borderColor: '#444', borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  filterText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 13 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  screen: { flex: 1, gap: spacing.md },
  search: { backgroundColor: colors.panel, borderRadius: radius.md, color: colors.warmWhite, fontFamily: typography.body, fontSize: 16, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  selectedFilter: { borderColor: colors.orange },
})
