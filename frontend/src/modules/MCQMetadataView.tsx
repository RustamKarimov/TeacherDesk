import { Tags } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQMetadataPayload } from "../types";

export function MCQMetadataView() {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/mcq/metadata/`)
      .then((response) => readJson<MCQMetadataPayload>(response))
      .then(setMetadata)
      .catch(() => setMetadata(null));
  }, []);

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Metadata</h1>
          <span className="header-subtitle">Manage topics, subtopics, tags, difficulty labels, and portable MCQ bank packaging.</span>
        </div>
      </section>
      <section className="dashboard-command">
        <div className="dashboard-widget">
          <div className="dashboard-widget-head"><div><strong>Topics</strong><span>Reusable metadata for MCQ generation and future analytics.</span></div></div>
          <div className="folder-table">
            {metadata?.topics.length ? metadata.topics.map((topic) => (
              <div className="folder-table-row" key={topic.id}><strong>{topic.name}</strong><span>{topic.subtopics.length} subtopics</span><small className="ok">{topic.question_count} questions</small></div>
            )) : <div className="empty-state"><Tags size={30} /><strong>No MCQ topics yet</strong><span>Topics can be created here when the full metadata editor is implemented.</span></div>}
          </div>
        </div>
      </section>
    </>
  );
}
