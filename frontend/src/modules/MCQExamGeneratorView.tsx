import { FileText, Shuffle } from "lucide-react";

export function MCQExamGeneratorView() {
  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Exam Generator</h1>
          <span className="header-subtitle">Full paper, topic-based, and manual MCQ paper generation will live here.</span>
        </div>
      </section>
      <section className="dashboard-command">
        <div className="dashboard-widget">
          <div className="empty-state"><Shuffle size={32} /><strong>Generator foundation ready</strong><span>The question bank comes first; generation will use the same structured question, option, layout, and answer-key records.</span></div>
        </div>
        <div className="dashboard-widget">
          <div className="folder-table">
            <div className="folder-table-row"><strong>Full paper</strong><span>Random selection from Ready/Verified questions</span><small className="ok">Planned</small></div>
            <div className="folder-table-row"><strong>Topic-based</strong><span>Rows with counts per topic/subtopic/tag</span><small className="ok">Planned</small></div>
            <div className="folder-table-row"><strong>Manual</strong><span>Exact basket of selected questions</span><small className="ok">Planned</small></div>
            <div className="folder-table-row"><strong>PDF output</strong><span>Student paper, teacher version, and answer key</span><small className="ok">Planned</small></div>
          </div>
        </div>
      </section>
    </>
  );
}
