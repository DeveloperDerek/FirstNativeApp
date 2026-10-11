import { rethrow } from '@/api/register';
import { supabase } from '@/lib/supabase';

// Reports (step-tracker-safety.txt, Part B). The server checks everything
// again; a second report on the same target while the first is open adds
// nothing, and the app says thanks either way.

export type ReportKind = 'person' | 'group';

export const REPORT_REASONS: Record<ReportKind, { id: string; label: string }[]> = {
  person: [
    { id: 'offensive_name', label: 'Offensive name' },
    { id: 'impersonation', label: 'Pretending to be someone else' },
    { id: 'harassment', label: 'Bullying or harassment' },
    { id: 'spam', label: 'Spam' },
    { id: 'other', label: 'Something else' },
  ],
  // A group is reported for its name; how people act is reported against them
  group: [
    { id: 'offensive_name', label: 'Offensive name' },
    { id: 'other', label: 'Something else' },
  ],
};

export const NOTE_MAX = 500;

export async function reportUser(personId: string, reason: string, note: string, alsoBlock: boolean) {
  const { error } = await supabase.rpc('report_user', {
    person: personId,
    reason,
    note: note.trim() || null,
    also_block: alsoBlock,
  });
  if (error) rethrow(error);
}

export async function reportGroup(groupId: string, reason: string, note: string) {
  const { error } = await supabase.rpc('report_group', {
    gid: groupId,
    reason,
    note: note.trim() || null,
  });
  if (error) rethrow(error);
}
