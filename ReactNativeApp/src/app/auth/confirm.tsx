import { AuthLinkScreen } from '@/components/auth-link-screen';

// reactnativeapp://auth/confirm?token_hash=...&type=email (sign-up confirmation)
export default function ConfirmLinkScreen() {
  return <AuthLinkScreen kind="confirm" />;
}
