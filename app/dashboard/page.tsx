import { redirect } from "next/navigation";

export default function DashboardPage() {
  // Dashboard now lives at "/" — keep old URL working via redirect
  redirect("/");
}
