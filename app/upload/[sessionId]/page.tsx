import { notFound } from "next/navigation";
import { MobileUpload } from "../../../components/upload/mobile-upload";

// This route is intentionally unauthenticated (students scan a QR code).
// The session-delivery feature (sending the uploaded PDF to the teacher's board)
// is NOT yet implemented — uploads only reach the local importDocument() helper.
// Until the Supabase session handshake is complete, reject any request that
// would make a student believe their file was delivered to the classroom.
const SESSION_UPLOAD_ENABLED = process.env.ENABLE_SESSION_UPLOAD === "true";

export default async function UploadPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!SESSION_UPLOAD_ENABLED) {
    // Return 404 rather than exposing an unfinished, permanently-open endpoint.
    notFound();
  }
  const { sessionId } = await params;
  return <MobileUpload sessionId={sessionId} />;
}
