import { AlertTriangle, BookOpen, BookOpenCheck, CheckCircle2, Database, FolderOpen, Settings, Shuffle, Tags, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { DashboardPayload, MCQDashboardPayload } from "../types";

type DashboardModuleName = "Dashboard" | "Splitter" | "Question Bank" | "Exam Generator" | "Settings" | "MCQ Question Bank" | "Add MCQ Question" | "MCQ Exam Generator" | "MCQ Metadata";

export function DashboardView({ onOpenModule }: { onOpenModule: (module: DashboardModuleName) => void }) {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [mcqDashboard, setMcqDashboard] = useState<MCQDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [reviewTab, setReviewTab] = useState<"all" | "qp" | "ms">("all");

  useEffect(() => {
    fetch(`${API_BASE}/api/libraries/dashboard/`)
      .then((response) => readJson<DashboardPayload>(response))
      .then(setDashboard)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load dashboard."));
    fetch(`${API_BASE}/api/mcq/dashboard/`)
      .then((response) => readJson<MCQDashboardPayload>(response))
      .then(setMcqDashboard)
      .catch(() => setMcqDashboard(null));
  }, []);

  useEffect(() => {
    if (!dashboard || selectedCalendarDate) return;
    setSelectedCalendarDate(dashboard.recent_drafts[0]?.created_at.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  }, [dashboard, selectedCalendarDate]);

  const visibleReviewQueue = dashboard?.review_queue.filter((item) => {
    if (reviewTab === "qp") return item.qp_status === "needs_review";
    if (reviewTab === "ms") return item.ms_status === "needs_review";
    return true;
  }) ?? [];
  const reviewPreview = visibleReviewQueue.slice(0, 4);
  const draftDates = Array.from(new Set((dashboard?.recent_drafts ?? []).map((draft) => draft.created_at.slice(0, 10)))).slice(0, 7);
  const calendarDrafts = (dashboard?.recent_drafts ?? []).filter((draft) => draft.created_at.slice(0, 10) === selectedCalendarDate);

  return (
    <>
      <section className="content-header dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <span className="header-subtitle">Command center for your teaching workload</span>
        </div>
      </section>

      <section className="dashboard-command">
        {error ? <div className="callout error">{error}</div> : null}
        {!dashboard && !error ? <div className="empty-state"><Database size={30} /><strong>Loading dashboard</strong><span>Reading your local library summary.</span></div> : null}

        {dashboard ? (
          <>
            <div className="dashboard-module-row">
              <ModuleStatusCard
                icon={FolderOpen}
                title="Splitter"
                subtitle="Pipeline Status"
                badge="Ready"
                onOpen={() => onOpenModule("Splitter")}
                stats={[
                  ["Manifest", dashboard.paths.manifest ? "1" : "0", dashboard.paths.manifest ? "Loaded" : "Not set"],
                  ["Questions Indexed", String(dashboard.modules.splitter.primary), `Across ${dashboard.modules.splitter.secondary} exams`],
                ]}
                action="Open Splitter"
              />
              <ModuleStatusCard
                icon={BookOpen}
                title="Question Bank"
                subtitle="Review Queue"
                badge="Needs Attention"
                tone="warning"
                onOpen={() => onOpenModule("Question Bank")}
                stats={[
                  ["Total Questions", String(dashboard.modules.question_bank.primary), ""],
                  ["Review Flags", String(dashboard.review_counts.all), `QP: ${dashboard.review_counts.qp}  MS: ${dashboard.review_counts.ms}`],
                ]}
                action="Open Question Bank"
              />
              <ModuleStatusCard
                icon={Shuffle}
                title="Exam Generator"
                subtitle="Drafts & Exams"
                onOpen={() => onOpenModule("Exam Generator")}
                stats={[
                  ["Saved Drafts", String(dashboard.modules.exam_generator.primary), "Last updated today"],
                  ["Generated PDFs", String(dashboard.modules.exam_generator.secondary), "Ready to use"],
                ]}
                action="Open Exam Generator"
              />
              <ModuleStatusCard
                icon={Settings}
                title="Settings"
                subtitle="System Health"
                badge={dashboard.folder_health.every((item) => item.ready) ? "All Good" : "Check"}
                tone={dashboard.folder_health.every((item) => item.ready) ? "success" : "warning"}
                onOpen={() => onOpenModule("Settings")}
                stats={[
                  ["Library", "Active", dashboard.library.name],
                  ["Folders", dashboard.folder_health.every((item) => item.ready) ? "Ready" : "Needs setup", "Local storage"],
                ]}
                action="Open Settings"
              />
              <ModuleStatusCard
                icon={BookOpenCheck}
                title="MCQ Bank"
                subtitle="Multiple-choice questions"
                badge={mcqDashboard ? "Ready" : "Offline"}
                tone={mcqDashboard ? "success" : "warning"}
                onOpen={() => onOpenModule("MCQ Question Bank")}
                stats={[
                  ["Questions", String(mcqDashboard?.summary.questions ?? 0), `${mcqDashboard?.summary.ready_verified ?? 0} ready / verified`],
                  ["Review", String(mcqDashboard?.summary.needs_review ?? 0), "Needs checking"],
                ]}
                action="Open MCQ Bank"
              />
              <ModuleStatusCard
                icon={Shuffle}
                title="MCQ Generator"
                subtitle="Variants & answer keys"
                onOpen={() => onOpenModule("MCQ Exam Generator")}
                stats={[
                  ["Generated", String(mcqDashboard?.summary.generated_papers ?? 0), "MCQ paper sets"],
                  ["Assets", String(mcqDashboard?.summary.assets ?? 0), "Local images"],
                ]}
                action="Open MCQ Generator"
              />
              <ModuleStatusCard
                icon={Tags}
                title="MCQ Metadata"
                subtitle="Topics, tags, subtopics"
                onOpen={() => onOpenModule("MCQ Metadata")}
                stats={[
                  ["Topics", String(mcqDashboard?.summary.topics ?? 0), "Reusable filters"],
                  ["Equations", String(mcqDashboard?.coverage.equation ?? 0), "Question coverage"],
                ]}
                action="Open Metadata"
              />
            </div>

            <section className="dashboard-widget calendar-widget">
              <div className="dashboard-widget-head">
                <div><strong>Exam Generation Calendar / Queue</strong><span>Recent drafts and generated exams</span></div>
                <input className="calendar-date-input" type="date" value={selectedCalendarDate} onChange={(event) => setSelectedCalendarDate(event.target.value)} />
              </div>
              <div className="calendar-strip">
                {(draftDates.length ? draftDates : [selectedCalendarDate]).map((date) => (
                  <button className={selectedCalendarDate === date ? "active" : ""} key={date} onClick={() => setSelectedCalendarDate(date)}>{formatDashboardDate(date)}</button>
                ))}
              </div>
              <div className="exam-queue">
                {calendarDrafts.length ? calendarDrafts.map((draft, index) => (
                  <button className="exam-queue-row" key={draft.id} onClick={() => onOpenModule("Exam Generator")}>
                    <span className="queue-time">{["09:30", "13:15", "15:45", "16:20", "17:10"][index] ?? "09:00"}</span>
                    <strong>{draft.title}</strong>
                    <small>Paper {draft.paper ?? "-"}</small>
                    <span className={draft.generated ? "mini-status ok" : "mini-status warn"}>{draft.generated ? "Generated" : "Draft"}</span>
                    <small>{draft.questions}</small>
                    <small>{draft.marks}</small>
                    <FolderOpen size={15} />
                  </button>
                )) : <div className="dashboard-empty">No exam drafts on this date.</div>}
              </div>
            </section>

            <section className="dashboard-widget folders-widget">
              <div className="dashboard-widget-head">
                <div><strong>Local Folders Status</strong><span>Configured local storage paths</span></div>
              </div>
              <div className="folder-table">
                {dashboard.folder_health.map((item) => (
                  <div className="folder-table-row" key={item.label}>
                    <strong>{item.label}</strong>
                    <span>{item.path || "Not set"}</span>
                    <small className={item.ready ? "ok" : "warn"}>{item.ready ? "Found" : "Check"}</small>
                  </div>
                ))}
              </div>
              <button className="dashboard-link" onClick={() => onOpenModule("Settings")}>Open Settings to manage folders</button>
            </section>

            <section className="dashboard-widget review-widget">
              <div className="dashboard-widget-head">
                <div><strong>Review Flags</strong><span>Questions needing manual checking</span></div>
                <button className="ghost-button" onClick={() => onOpenModule("Question Bank")}>View all</button>
              </div>
              <div className="review-tabs">
                <button className={reviewTab === "all" ? "active" : ""} onClick={() => setReviewTab("all")}>All ({dashboard.review_counts.all})</button>
                <button className={reviewTab === "qp" ? "active" : ""} onClick={() => setReviewTab("qp")}>QP ({dashboard.review_counts.qp})</button>
                <button className={reviewTab === "ms" ? "active" : ""} onClick={() => setReviewTab("ms")}>MS ({dashboard.review_counts.ms})</button>
              </div>
              <div className="queue-list">
                {reviewPreview.length ? reviewPreview.map((item) => (
                  <button key={item.id} className="queue-row" onClick={() => onOpenModule("Question Bank")}>
                    <span className="mono">{item.exam}</span>
                    <strong>{item.paper} {item.question}</strong>
                    <small>{item.marks ?? "-"} marks</small>
                    <span className={item.qp_status === "needs_review" || item.ms_status === "needs_review" ? "mini-status warn" : "mini-status"}>Review</span>
                  </button>
                )) : <div className="dashboard-empty">No {reviewTab === "all" ? "" : reviewTab.toUpperCase()} review items right now.</div>}
                {visibleReviewQueue.length > reviewPreview.length ? (
                  <button className="dashboard-link review-more-link" onClick={() => onOpenModule("Question Bank")}>
                    View {visibleReviewQueue.length - reviewPreview.length} more in Question Bank
                  </button>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </>
  );
}

function ModuleStatusCard({
  icon: Icon,
  title,
  subtitle,
  badge,
  tone = "default",
  stats,
  action,
  onOpen,
}: {
  icon: typeof FolderOpen;
  title: string;
  subtitle: string;
  badge?: string;
  tone?: "default" | "warning" | "success";
  stats: Array<[string, string, string]>;
  action: string;
  onOpen: () => void;
}) {
  return (
    <button className={`module-status-card ${tone}`} onClick={onOpen}>
      <div className="module-card-head">
        <div><Icon size={17} /><strong>{title}</strong></div>
        {badge ? <StatusBadge label={badge} tone={tone} /> : null}
      </div>
      <small>{subtitle}</small>
      <div className="module-card-stats">
        {stats.map(([label, value, caption]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            {caption ? <small>{caption}</small> : null}
          </div>
        ))}
      </div>
      <em>{action}</em>
    </button>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "default" | "warning" | "success" }) {
  const Icon = label === "Offline" ? WifiOff : tone === "warning" ? AlertTriangle : CheckCircle2;
  return (
    <span className="module-status-icon" title={label} aria-label={label}>
      <Icon size={15} />
    </span>
  );
}

function formatDashboardDate(date: string) {
  if (!date) return "Select date";
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
