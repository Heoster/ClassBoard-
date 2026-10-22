import Link from "next/link";

import { SignInPanel } from "../../components/auth/sign-in-panel";

export default function SignInPage() {
    return (
        <main className="auth-page" style={{ justifyContent: "center" }}>
            <section style={{ maxWidth: "440px", margin: "0 auto" }}>
                <Link href="/">← MAPLES ACADEMY SMARTBOARD TOOL</Link>
                <h1>Account Access</h1>
                <p>Sign in to your account or create a new account to save classroom lessons.</p>
                <SignInPanel />
            </section>
        </main>
    );
}
