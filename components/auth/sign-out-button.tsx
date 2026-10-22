"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseBrowserClient } from "../../lib/supabase/client";

export function SignOutButton() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const signOut = async () => {
        setLoading(true);
        try {
            const client = getSupabaseBrowserClient();
            await client.auth.signOut();
        } finally {
            router.push("/sign-in");
            router.refresh();
        }
    };

    return (
        <button className="secondary" type="button" disabled={loading} onClick={() => void signOut()}>
            {loading ? "Signing out…" : "Sign out"}
        </button>
    );
}
