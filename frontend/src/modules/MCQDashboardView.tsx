import { Archive, BadgeCheck, BookOpenCheck, Database, FileQuestion, Image, Plus, Table2, Tags, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQDashboardPayload } from "../types";

type MCQModuleName = "MCQ Question Bank" | "Add MCQ Question" | "MCQ Exam Generator" | "MCQ Metadata";

export function MCQDashboardView({ onOpenModule }: { onOpenModule: (module: MCQModuleName) => void }) {
  const [dashboard, setDashboard] = useState<MCQDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/mcq/dashboard/`)
      .then((response) => readJson<MCQDashboardPayload>(response))
      .then(setDashboard)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ dashboard."));
  }, []);

  return (
    <>
      <section className="content-header dashboard-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Builder</h1>
          <span className="header-subtitle">Create structured multiple-choice questions and generate printable exams.</span>
        </div>
        <div className="header-actions">
          <button className="secondary-action" onClick={() => onOpenModule("MCQ Question Bank")}><BookOpenCheck size={17} />Open MCQ bank</button>
          <button className="primary-action" onClick={() => onOpenModule("Add MCQ Question")}><Plus size={17} />Add MCQ question</button>
        </div>
      </section>

      <section className="dashboard-command mcq-command">
        {error ? <div className="callout error">{error}</div> : null}
        {!dashboard && !error ? <div className="empty-state"><Database size={30} /><strong>Loading MCQ dashboard</strong><span>Reading your local MCQ bank.</span></div> : null}
        {dashboard ? (
          <>
            <div className="stat-grid four">
              <MCQStatCard icon={FileQuestion} label="Total MCQ Questions" value={dashboard.summary.questions} note="Structured records" />
              <MCQStatCard icon={BadgeCheck} label="Ready / Verified" value={dashboard.summary.ready_verified} note="Default exam pool" tone="success" />
              <MCQStatCard icon={TriangleAlert} label="Needs Review" value={dashboard.summary.needs_review} note="Check before use" tone="warning" />
              <MCQStatCard icon={Archive} label="Generated Papers" value={dashboard.summary.generated_papers} note="PDF-ready exams" />
            </div>

            <div className="mcq-dashboard-grid">
              <section className="dashboard-widget">
                <div className="dashboard-widget-head">
                  <div><strong>Recent MCQ Questions</strong><span>Latest question records in your local bank</span></div>
                  <button className="ghost-button" onClick={() => onOpenModule("MCQ Question Bank")}>View bank</button>
                </div>
                <div className="mcq-list">
                  {dashboard.recent_questions.length ? dashboard.recent_questions.map((question) => (
                    <button className="mcq-list-row" key={question.id} onClick={() => onOpenModule("MCQ Question Bank")}>
                      <strong>{question.title || `MCQ #${question.id}`}</strong>
                      <span>{question.topics.map((topic) => topic.name).join(", ") || "No topic yet"}</span>
                      <small>{question.marks} mark · {question.option_count || 0} options · {question.review_status_label}</small>
                    </button>
                  )) : <div className="dashboard-empty">No MCQ questions yet. Add your first structured question.</div>}
                </div>
              </section>

              <section className="dashboard-widget">
                <div className="dashboard-widget-head">
                  <div><strong>Question Type Coverage</strong><span>Content types used in the MCQ bank</span></div>
                </div>
                <div className="coverage-grid">
                  <span><FileQuestion size={16} />Text blocks<strong>{dashboard.coverage.text}</strong></span>
                  <span><Image size={16} />Image assets<strong>{dashboard.coverage.image}</strong></span>
                  <span><Table2 size={16} />Table options<strong>{dashboard.coverage.table}</strong></span>
                  <span><Tags size={16} />Equations<strong>{dashboard.coverage.equation}</strong></span>
                </div>
              </section>
            </div>

            <section className="dashboard-widget">
              <div className="dashboard-widget-head">
                <div><strong>Local MCQ Storage</strong><span>Everything remains local and portable for future export/import packages.</span></div>
              </div>
              <div className="folder-table">
                <div className="folder-table-row"><strong>MCQ questions</strong><span>Saved in the local TeacherDesk database</span><small className="ok">Ready</small></div>
                <div className="folder-table-row"><strong>Images/assets</strong><span>Stored locally and linked through asset records</span><small className="ok">{dashboard.summary.assets} assets</small></div>
                <div className="folder-table-row"><strong>Metadata</strong><span>Topics, subtopics, tags, layout presets, and answer keys</span><small className="ok">{dashboard.summary.topics} topics</small></div>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </>
  );
}

function MCQStatCard({ icon: Icon, label, value, note, tone = "default" }: { icon: typeof FileQuestion; label: string; value: number; note: string; tone?: "default" | "success" | "warning" }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon"><Icon size={20} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}
