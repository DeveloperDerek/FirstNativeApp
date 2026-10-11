import { AuthLinkScreen } from '@/components/auth-link-screen';

// reactnativeapp://auth/reset?token_hash=...&type=recovery (password reset)
export default function ResetLinkScreen() {
  return <AuthLinkScreen kind="reset" />;
}
