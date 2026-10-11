import { currentLegalDocs, registerErrorMessage } from '@/auth/register';
import { type AccountStatus, type LegalDoc, parseAccountStatus } from '@/auth/route';
import { supabase } from '@/lib/supabase';

/**
 * A refusal from the server with a known code (USERNAME_TAKEN, ...). The
 * message is already in words. Anything else (no connection, a timeout)
 * is thrown as it came.
 */
export class RegisterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** Throws a known server code as a RegisterError in words, anything else as it came. */
export function rethrow(error: { message: string }): never {
  const words = registerErrorMessage(error.message);
  if (words) throw new RegisterError(error.message, words);
  throw error;
}

/**
 * The current Terms and Privacy Policy, for step 1's checkbox (readable
 * signed out). Empty while none are published.
 */
export async function getCurrentLegalDocs(): Promise<LegalDoc[]> {
  const { data, error } = await supabase
    .from('legal_documents')
    .select('document, version, url, published_at');
  if (error) throw error;
  return currentLegalDocs(data);
}

/** Which screen the signed-in user should see (section 7). */
export async function getAccountStatus(): Promise<AccountStatus> {
  const { data, error } = await supabase.rpc('account_status');
  if (error) throw error;
  return parseAccountStatus(data);
}

/**
 * Step 2, saved in one go. 'ALREADY_ONBOARDED' means an earlier try
 * already worked; treat it as success. 'UNDER_AGE' means the account is
 * now blocked.
 */
export async function completeSignup(answers: {
  username: string;
  displayName: string;
  birthDate: string;
  /** The versions ticked on screen; leave out when there was no checkbox. */
  terms?: LegalDoc[];
}): Promise<'OK' | 'ALREADY_ONBOARDED' | 'UNDER_AGE'> {
  const { data, error } = await supabase.rpc('complete_signup', {
    p_username: answers.username,
    p_display_name: answers.displayName,
    p_birth_date: answers.birthDate,
    p_terms: answers.terms?.length ? versionsOf(answers.terms) : null,
  });
  if (error) rethrow(error);
  return data;
}

/** For the live tick while typing. */
export async function usernameAvailable(name: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('username_available', {
    p_name: name,
  });
  if (error) rethrow(error);
  return data;
}

/** Rename from the Profile tab. Returns the cleaned name. */
export async function changeUsername(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('change_username', {
    p_name: name,
  });
  if (error) rethrow(error);
  return data;
}

/** The "Updated Terms" screen. */
export async function acceptLegalDocuments(docs: LegalDoc[]) {
  const { error } = await supabase.rpc('accept_legal_documents', {
    p_versions: versionsOf(docs),
  });
  if (error) rethrow(error);
}

const versionsOf = (docs: LegalDoc[]) =>
  Object.fromEntries(docs.map((d) => [d.document, d.version]));

export type Birthday = {
  /** 'YYYY-MM-DD', or null for accounts made before birthdays were asked */
  birthDate: string | null;
  /** A "Wrong date?" request support hasn't handled yet */
  openRequestSince: string | null;
};

/** Your own birthday: nobody else can read it (section 5). */
export async function getMyBirthday(userId: string): Promise<Birthday> {
  const [mine, request] = await Promise.all([
    supabase.from('profile_private').select('birth_date').eq('user_id', userId).maybeSingle(),
    supabase
      .from('birthday_correction_requests')
      .select('created_at')
      .eq('status', 'open')
      .maybeSingle(),
  ]);
  if (mine.error) throw mine.error;
  if (request.error) throw request.error;
  return {
    birthDate: mine.data?.birth_date ?? null,
    openRequestSince: request.data?.created_at ?? null,
  };
}

/** Profile > "Wrong date?": a request support checks (section 6g). */
export async function requestBirthdayCorrection(birthDate: string, note: string) {
  const { error } = await supabase.rpc('request_birthday_correction', {
    p_birth_date: birthDate,
    p_note: note,
  });
  if (error) rethrow(error);
}
