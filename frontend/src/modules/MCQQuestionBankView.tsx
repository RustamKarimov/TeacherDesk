import { BadgeCheck, Copy, FileQuestion, Image, Pencil, Plus, Search, Table2, Tags, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQAsset, MCQMetadataPayload, MCQQuestionListPayload, MCQQuestionRow } from "../types";

type MCQQuestionDetailPayload = MCQQuestionRow & {
  notes: string;
  teacher_notes: string;
  layout_settings: Record<string, unknown>;
  blocks: Array<{ id: number; block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; order: number }>;
  options: Array<{
    id: number;
    label: string;
    is_correct: boolean;
    order: number;
    blocks: Array<{ id: number; block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; order: number }>;
  }>;
};

export function MCQQuestionBankView({ onAddQuestion, onEditQuestion }: { onAddQuestion: () => void; onEditQuestion: (questionId: number) => void }) {
  const [rows, setRows] = useState<MCQQuestionRow[]>([]);
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [contentType, setContentType] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState<MCQQuestionDetailPayload | null>(null);
  const [isTeacherView, setIsTeacherView] = useState(false);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    fetch(`${API_BASE}/api/mcq/metadata/`)
      .then((response) => readJson<MCQMetadataPayload>(response))
      .then(setMetadata)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ metadata."));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: "10" });
    if (search) params.set("search", search);
    if (topic) params.set("topic", topic);
    if (reviewStatus) params.set("review_status", reviewStatus);
    if (contentType) params.set("content_type", contentType);
    fetch(`${API_BASE}/api/mcq/questions/?${params.toString()}`)
      .then((response) => readJson<MCQQuestionListPayload>(response))
      .then((payload) => {
        setRows(payload.results);
        setCount(payload.count);
        setPageCount(payload.page_count);
        setSelectedId((current) => current ?? payload.results[0]?.id ?? null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ questions."));
  }, [search, topic, reviewStatus, contentType, page, reloadToken]);

  useEffect(() => {
    if (!selected?.id) {
      setSelectedDetail(null);
      return;
    }
    fetch(`${API_BASE}/api/mcq/questions/${selected.id}/`)
      .then((response) => readJson<MCQQuestionDetailPayload>(response))
      .then(setSelectedDetail)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ preview."));
  }, [selected?.id, reloadToken]);

  async function duplicateQuestion(questionId: number) {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/questions/${questionId}/duplicate/`, { method: "POST" });
      await readJson(response);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not duplicate MCQ question.");
    }
  }

  async function deleteQuestion(questionId: number) {
    if (!confirm("Delete this MCQ question?")) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/questions/${questionId}/delete/`, { method: "POST" });
      await readJson(response);
      setSelectedId(null);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete MCQ question.");
    }
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Question Bank</h1>
          <span className="header-subtitle">Browse, filter, edit, and select structured MCQ questions.</span>
        </div>
        <button className="primary-action" onClick={onAddQuestion}><Plus size={17} />Add question</button>
      </section>

      <section className="workbench mcq-bank-workbench">
        <div className="panel mcq-bank-panel">
          {error ? <div className="callout error">{error}</div> : null}
          <div className="filters-toolbar">
            <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search text, topic, source, or tag" /></label>
            <select value={topic} onChange={(event) => { setTopic(event.target.value); setPage(1); }}>
              <option value="">All topics</option>
              {metadata?.topics.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
            <select value={contentType} onChange={(event) => { setContentType(event.target.value); setPage(1); }}>
              <option value="">Any content</option>
              <option value="image">Has image</option>
              <option value="table">Has table</option>
              <option value="equation">Has equation</option>
            </select>
            <select value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value); setPage(1); }}>
              <option value="">Any status</option>
              {metadata?.review_statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>

          <div className="results-head">
            <div><strong>Results</strong><span>{count} MCQ questions</span></div>
            <button className="secondary-action"><Plus size={16} />Add selected to exam</button>
          </div>

          <div className="mcq-table">
            <div className="mcq-table-head">
              <span>Question</span><span>Topics</span><span>Type</span><span>Marks</span><span>Status</span><span>Actions</span>
            </div>
            {rows.length ? rows.map((row) => (
              <div className={`mcq-table-row ${selected?.id === row.id ? "active" : ""}`} key={row.id} onClick={() => setSelectedId(row.id)} role="button" tabIndex={0}>
                <span><strong>{row.title || `MCQ #${row.id}`}</strong><small>{row.exam_code || row.source || "Manual question"}</small></span>
                <span className="chip-wrap">{row.topics.slice(0, 2).map((item) => <em key={item.id}>{item.name}</em>)}{row.topics.length > 2 ? <em>+{row.topics.length - 2}</em> : null}</span>
                <span className="content-icons">{row.has_images ? <Image size={16} /> : null}{row.has_tables ? <Table2 size={16} /> : null}{row.has_equations ? <Tags size={16} /> : null}</span>
                <span>{row.marks}</span>
                <span className={`mini-status ${row.review_status === "needs_review" ? "warn" : row.review_status === "verified" || row.review_status === "ready" ? "ok" : ""}`}>{row.review_status_label}</span>
                <span className="row-actions">
                  <button className="icon-button" onClick={(event) => { event.stopPropagation(); onEditQuestion(row.id); }} title="Edit question"><Pencil size={15} /></button>
                  <button className="icon-button" onClick={(event) => { event.stopPropagation(); duplicateQuestion(row.id); }} title="Duplicate question"><Copy size={15} /></button>
                  <button className="icon-button danger-icon" onClick={(event) => { event.stopPropagation(); deleteQuestion(row.id); }} title="Delete question"><Trash2 size={15} /></button>
                </span>
              </div>
            )) : <div className="dashboard-empty">No MCQ questions match these filters.</div>}
          </div>

          <div className="pagination-bar">
            <button className="ghost-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))}>Previous</button>
            <span>Page {page} of {pageCount}</span>
            <button className="ghost-button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(current + 1, pageCount))}>Next</button>
          </div>
        </div>

        <aside className="panel mcq-preview-panel">
          <div className="dashboard-widget-head">
            <div><strong>A4 Preview</strong><span>Student view of the selected question</span></div>
            <button className="ghost-button" onClick={() => setIsTeacherView((current) => !current)}>{isTeacherView ? "Student view" : "Teacher view"}</button>
          </div>
          {selected && selectedDetail ? (
            <>
              <div className="a4-preview-card">
                <div className="paper-question-number">1</div>
                <strong>{selected.title || "Untitled MCQ question"}</strong>
                {selectedDetail.blocks
                  .slice()
                  .sort((left, right) => left.order - right.order)
                  .map((block) => (
                    block.block_type === "image" && block.asset ? (
                      <img className="a4-question-image" src={`${API_BASE}${block.asset.preview_url}`} alt={block.asset.original_name} key={block.id} />
                    ) : block.text ? (
                      <p key={block.id}>{block.text}</p>
                    ) : null
                  ))}
                <div className={`option-preview-grid layout-${selectedDetail.option_layout}`}>
                  {selectedDetail.options
                    .slice()
                    .sort((left, right) => left.order - right.order)
                    .map((option) => (
                      <span className={isTeacherView && option.is_correct ? "correct" : ""} key={option.id}>
                        <b>{option.label}.</b>
                        {option.blocks.length ? option.blocks
                          .slice()
                          .sort((left, right) => left.order - right.order)
                          .map((block) => (
                            block.block_type === "image" && block.asset ? (
                              <img className="a4-option-image" src={`${API_BASE}${block.asset.preview_url}`} alt={block.asset.original_name} key={block.id} />
                            ) : block.text ? (
                              <span className="option-text-fragment" key={block.id}>{block.text}</span>
                            ) : null
                          )) : <span className="option-text-fragment">Answer option</span>}
                      </span>
                    ))}
                </div>
                {isTeacherView ? <div className="teacher-preview-note">Correct answer: {selected.correct_option || "not set"}</div> : null}
              </div>
              <div className="metadata-mini">
                <span><BadgeCheck size={15} />{selected.review_status_label}</span>
                <span>{selected.marks} mark</span>
                <span>{selected.option_layout_label}</span>
              </div>
            </>
          ) : selected ? <div className="empty-state"><FileQuestion size={30} /><strong>Loading preview</strong><span>Fetching the selected question blocks.</span></div> : <div className="empty-state"><FileQuestion size={30} /><strong>No question selected</strong><span>Select or create an MCQ question to preview it.</span></div>}
        </aside>
      </section>
    </>
  );
}
