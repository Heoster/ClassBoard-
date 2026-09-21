import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "../../lib/supabase/server";

const recentLessons = [
	{ title: "Introduction to Fractions", meta: "Math 5A · Edited today", tone: "blue" },
	{ title: "The Water Cycle", meta: "Science 6B · Edited yesterday", tone: "green" },
	{ title: "World Regions Review", meta: "Geography · Edited Sep 10", tone: "orange" },
];

export default async function DashboardPage() {
	const client = await getSupabaseServerClient();
	const [{ data: cloudDocuments }, { count: annotationCount }, { data: authData, error: authError }] = await Promise.all([
		client.from("documents").select("id,filename,document_type,updated_at,page_count").order("updated_at", { ascending: false }).limit(6),
		client.from("annotations").select("id", { count: "exact", head: true }),
		client.auth.getUser(),
	]);
	if (authError || !authData.user) redirect("/sign-in");
	const user = authData.user;
	const { data: documentTotals } = await client.from("documents").select("id,page_count,updated_at");
	const pdfCount = documentTotals?.length ?? 0;
	const pageCount = documentTotals?.reduce((total, document) => total + (document.page_count ?? 0), 0) ?? 0;
	const weekStart = new Date();
	weekStart.setDate(weekStart.getDate() - 6);
	const recentActivity = documentTotals?.filter(document => new Date(document.updated_at) >= weekStart).length ?? 0;
	const activityBars = Array.from({ length: 7 }, (_, index) => Math.max(12, Math.min(100, ((recentActivity + index * 3) % 9 + 2) * 10)));
	const dashboardDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
	const lessons = cloudDocuments?.length ? cloudDocuments.map((document, index) => ({ title: document.filename, meta: `${document.document_type.toUpperCase()} · Updated ${new Date(document.updated_at).toLocaleDateString()}`, tone: ["blue", "green", "orange"][index % 3], href: `/viewer?doc=${document.id}` })) : recentLessons.map(lesson => ({ ...lesson, href: "/viewer" }));
	return <main className="dashboard">
		<header className="dashboard-header">
			<Link className="brand" href="/"><span className="brand-mark">M</span><span>MAPLES ACADEMY<br /><small>SMARTBOARD TOOL</small></span></Link>
			<nav aria-label="Main navigation"><Link className="nav-active" href="/dashboard">Workspace</Link><Link href="/documents">Documents</Link><Link href="/viewer">Present</Link><Link href="/settings">Account</Link></nav>
			<Link className="primary" href="/upload">+ UPLOAD PDF</Link>
		</header>
		<div className="dashboard-shell">
			<aside className="dashboard-sidebar"><p className="sidebar-label">Workspace</p><Link className="sidebar-active" href="/dashboard">▦ <span>Overview</span></Link><Link href="/documents">▤ <span>All documents</span></Link><Link href="/documents">◉ <span>Shared with me</span></Link><p className="sidebar-label sidebar-spacer">Manage</p><Link href="/documents">□ <span>PDF library</span></Link><Link href="/settings">⚙ <span>Settings</span></Link><div className="sidebar-footer"><strong>{user?.email ?? "Maples Academy"}</strong><span>Teacher workspace</span></div></aside>
			<section className="dashboard-content">
				<div className="dashboard-welcome"><div><p className="eyebrow">{dashboardDate}</p><h1>Good morning, teacher.</h1><p>Pick up where you left off or start a fresh lesson.</p></div><div className="status-pill"><span /> All systems ready</div></div>
				<div className="dashboard-grid">
					<section className="dashboard-panel quick-panel"><div className="panel-heading"><div><p className="eyebrow">QUICK START</p><h2>Build something new</h2></div><span className="panel-icon">✦</span></div><div className="quick-actions"><Link href="/viewer"><span className="action-icon blue-icon">＋</span><span><strong>Blank board</strong><small>Start with a clean canvas</small></span><b>→</b></Link><Link href="/viewer"><span className="action-icon purple-icon">▧</span><span><strong>Upload PDF</strong><small>Save a lesson to the cloud</small></span><b>→</b></Link></div></section>
					<section className="dashboard-panel stats-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE LIBRARY</p><h2>Your activity</h2></div><span className="panel-icon">↗</span></div><div className="stats"><div><strong>{pdfCount}</strong><span>PDFs saved</span></div><div><strong>{annotationCount ?? 0}</strong><span>Annotations</span></div><div><strong>{pageCount}</strong><span>Pages available</span></div></div><div className="activity-bar">{activityBars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div><div className="days"><span>6d ago</span><span>5d</span><span>4d</span><span>3d</span><span>2d</span><span>Yesterday</span><span>Today</span></div><p className="activity-summary">{recentActivity} document{recentActivity === 1 ? "" : "s"} updated in the last 7 days</p></section>
				</div>
				<section className="dashboard-panel lessons-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h2>Recent lessons</h2></div><Link className="text-link" href="/documents">View all →</Link></div><div className="lesson-list">{lessons.map((lesson, index) => <Link className="lesson-row" href={lesson.href} key={`${lesson.href}-${index}`}><span className={`lesson-thumb ${lesson.tone}`}><span>▤</span></span><span className="lesson-copy"><strong>{lesson.title}</strong><small>{lesson.meta}</small></span><span className="lesson-more">•••</span></Link>)}</div></section>
				<div className="dashboard-grid lower-grid"><section className="dashboard-panel announcement-panel"><div className="panel-heading"><div><p className="eyebrow">CLASSROOM TIP</p><h2>Keep your board clear</h2></div><span className="panel-icon">☼</span></div><p>Use the presentation view to hide your controls and keep students focused on the lesson.</p><Link className="text-link" href="/viewer">Open presentation view →</Link></section><section className="dashboard-panel storage-panel"><div className="panel-heading"><div><p className="eyebrow">LIBRARY STATUS</p><h2>Cloud library</h2></div><strong className="storage-number">{pdfCount}</strong></div><div className="storage-track"><span style={{ width: `${Math.min(100, pdfCount * 10)}%` }} /></div><p>{pdfCount === 0 ? "No PDFs saved yet" : `${pdfCount} PDF${pdfCount === 1 ? "" : "s"} available on your devices`}</p><Link className="text-link" href="/documents">Explore documents →</Link></section></div>
			</section>
		</div>
	</main>;
}
