import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/ssr";
import { SignInPanel } from "../../components/auth/sign-in-panel";

export default function SignInPage() {
  return (
    <main className="centered-shell" style={{ maxWidth: "440px" }}>
      <Link href="/" className="btn btn-ghost" style={{ justifySelf: "start", paddingLeft: "0.5rem" }}>
        <CaretLeft size={18} aria-hidden="true" /> Back
      </Link>
      <div className="stack">
        <h1>Sign in</h1>
        <p className="muted">Sign in to sync lessons and annotations. You can still open the board without an account.</p>
      </div>
      <SignInPanel />
    </main>
  );
}
