export type SessionEvent = { type: "login-approved" | "remote" | "upload"; payload: Record<string, unknown>; sentAt: string };
export type Session = { id: string; expiresAt: string };
export type Unsubscribe = () => void;
/** Realtime provider boundary: implementations must never put a privileged credential in a QR URL. */
export interface SessionTransport {
    createSession(): Promise<Session>;
    connect(sessionId: string): Promise<void>;
    send(event: SessionEvent): Promise<void>;
    subscribe(handler: (event: SessionEvent) => void): Unsubscribe;
}
