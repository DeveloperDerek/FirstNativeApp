import { supabase } from '@/lib/supabase';

export async function giveConsent(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ sharing_consent_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// Withdrawing consent also removes what was already uploaded
export async function withdrawConsent(userId: string) {
  const { error: e1 } = await supabase.from('daily_steps').delete().eq('user_id', userId);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from('profiles')
    .update({ sharing_consent_at: null })
    .eq('id', userId);
  if (e2) throw e2;
}
