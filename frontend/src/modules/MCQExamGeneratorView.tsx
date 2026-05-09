import { ClipboardList, Dice5, FileText, KeyRound, Plus, RefreshCw, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQMetadataPayload, MCQQuestionListPayload, MCQQuestionRow, MCQReviewStatus } from "../types";

type GeneratorMode = "full_paper" | "topic" | "manual";

function shuffleRows(rows: MCQQuestionRow[]) {
  const copy = [...rows];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normaliseQuestionNumber(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function pickFullPaper(rows: MCQQuestionRow[], questionCount: number) {
  const byNumber = new Map<string, MCQQuestionRow[]>();
  rows.forEach((row) => {
    const key = row.source_question_number || row.title || String(row.id);
    byNumber.set(key, [...(byNumber.get(key) ?? []), row]);
  });
  return [...byNumber.entries()]
    .sort(([left], [right]) => normaliseQuestionNumber(left) - normaliseQuestionNumber(right))
    .slice(0, questionCount)
    .map(([, group]) => shuffleRows(group)[0]);
}

function pickTopicPaper(rows: MCQQuestionRow[], topicIds: number[], questionCount: number) {
  const filtered = topicIds.length ? rows.filter((row) => topicIds.every((topicId) => row.topics.some((topic) => topic.id === topicId))) : rows;
  return shuffleRows(filtered).slice(0, questionCount);
}

export function MCQExamGeneratorView({
  manualQuestionIds = [],
  onManualQuestionsConsumed,
}: {
  manualQuestionIds?: number[];
  onManualQuestionsConsumed?: () => void;
}) {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [questions, setQuestions] = useState<MCQQuestionRow[]>([]);
  const [mode, setMode] = useState<GeneratorMode>(manualQuestionIds.length ? "manual" : "full_paper");
  const [title, setTitle] = useState("New MCQ paper");
  const [questionCount, setQuestionCount] = useState(40);
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [reviewPool, setReviewPool] = useState<"ready" | "all">("ready");
  const [selectedIds, setSelectedIds] = useState<number[]>(manualQuestionIds);
  const [previewIds, setPreviewIds] = useState<number[]>(manualQuestionIds);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/mcq/metadata/`)
      .then((response) => readJson<MCQMetadataPayload>(response))
      .then(setMetadata)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ metadata."));
    fetch(`${API_BASE}/api/mcq/questions/?page_size=100`)
      .then((response) => readJson<MCQQuestionListPayload>(response))
      .then((payload) => setQuestions(payload.results))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ questions."));
  }, []);

  useEffect(() => {
    if (!manualQuestionIds.length) return;
    setSelectedIds((current) => [...new Set([...current, ...manualQuestionIds])]);
    setPreviewIds((current) => [...new Set([...current, ...manualQuestionIds])]);
    setMode("manual");
    onManualQuestionsConsumed?.();
  }, [manualQuestionIds, onManualQuestionsConsumed]);

  const eligibleQuestions = useMemo(() => {
    const allowedStatuses: MCQReviewStatus[] = reviewPool === "ready" ? ["ready", "verified"] : ["draft", "ready", "needs_review", "verified", "archived"];
    return questions.filter((row) => allowedStatuses.includes(row.review_status));
  }, [questions, reviewPool]);

  const selectedQuestions = useMemo(() => previewIds.map((id) => questions.find((row) => row.id === id)).filter((row): row is MCQQuestionRow => Boolean(row)), [previewIds, questions]);
  const totalMarks = selectedQuestions.reduce((sum, row) => sum + row.marks, 0);

  function generatePreview() {
    const picked = mode === "manual"
      ? selectedIds.map((id) => questions.find((row) => row.id === id)).filter((row): row is MCQQuestionRow => Boolean(row))
      : mode === "topic"
        ? pickTopicPaper(eligibleQuestions, topicIds, questionCount)
        : pickFullPaper(eligibleQuestions, questionCount);
    setPreviewIds(picked.map((row) => row.id));
    setNotice(`${picked.length} questions prepared for preview. PDF export is the next wiring step.`);
  }

  function toggleTopic(topicId: number) {
    setTopicIds((current) => current.includes(topicId) ? current.filter((id) => id !== topicId) : [...current, topicId]);
  }

  function removePreviewQuestion(questionId: number) {
    setPreviewIds((current) => current.filter((id) => id !== questionId));
    setSelectedIds((current) => current.filter((id) => id !== questionId));
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Exam Generator</h1>
          <span className="header-subtitle">Create full-paper, topic-based, or manually selected MCQ exams from the structured bank.</span>
        </div>
        <button className="primary-action" onClick={generatePreview}><Shuffle size={17} />Generate preview</button>
      </section>

      <section className="mcq-generator-grid">
        <div className="panel mcq-generator-main">
          {error ? <div className="callout error">{error}</div> : null}
          {notice ? <div className="callout success">{notice}</div> : null}

          <div className="mcq-generator-card">
            <div className="dashboard-widget-head">
              <div><strong>Paper setup</strong><span>Choose a generation mode and the pool TeacherDesk should use.</span></div>
            </div>
            <div className="mcq-generator-fields">
              <label className="field-stack"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="field-stack"><span>Questions</span><input min={1} max={100} type="number" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value) || 1)} /></label>
              <label className="field-stack"><span>Question pool</span><select value={reviewPool} onChange={(event) => setReviewPool(event.target.value as "ready" | "all")}><option value="ready">Ready and verified only</option><option value="all">All questions</option></select></label>
            </div>

            <div className="mode-card-grid">
              <button className={mode === "full_paper" ? "active" : ""} onClick={() => setMode("full_paper")} type="button"><Dice5 size={19} /><strong>Full paper</strong><span>One random question per original question number.</span></button>
              <button className={mode === "topic" ? "active" : ""} onClick={() => setMode("topic")} type="button"><ClipboardList size={19} /><strong>Topic based</strong><span>Random questions matching selected topics.</span></button>
              <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")} type="button"><Plus size={19} /><strong>Manual basket</strong><span>Use questions sent from the MCQ bank.</span></button>
            </div>

            {mode === "topic" ? (
              <div className="topic-pick-panel">
                <strong>Topics</strong>
                <div className="chip-selector">
                  {(metadata?.topics ?? []).map((topic) => <button className={topicIds.includes(topic.id) ? "active" : ""} key={topic.id} onClick={() => toggleTopic(topic.id)} type="button">{topic.name}</button>)}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mcq-generator-card">
            <div className="dashboard-widget-head">
              <div><strong>Selected questions ({selectedQuestions.length})</strong><span>{totalMarks} marks. Questions appear in the order they will be exported.</span></div>
              <button className="secondary-action compact-action" onClick={generatePreview}><RefreshCw size={15} />Refresh</button>
            </div>
            <div className="generator-question-list">
              {selectedQuestions.length ? selectedQuestions.map((row, index) => (
                <div className="generator-question-row" key={row.id}>
                  <span className="order-badge">{index + 1}</span>
                  <span><strong>{row.title || `MCQ #${row.id}`}</strong><small>{row.exam_code || "Manual"} {row.source_question_number ? `/ ${row.source_question_number}` : ""}</small></span>
                  <span className="chip-wrap" title={row.topics.map((topic) => topic.name).join(", ")}>{row.topics.slice(0, 2).map((topic) => <em key={topic.id}>{topic.name}</em>)}</span>
                  <span>{row.marks} mark{row.marks === 1 ? "" : "s"}</span>
                  <button className="toolbar-icon-button danger-icon" onClick={() => removePreviewQuestion(row.id)} title="Remove question" type="button"><Trash2 size={16} /></button>
                </div>
              )) : <div className="dashboard-empty">Generate a preview or send questions from the MCQ Question Bank.</div>}
            </div>
          </div>
        </div>

        <aside className="panel mcq-output-panel">
          <div className="dashboard-widget-head">
            <div><strong>Output</strong><span>PDF generation will use this preview and produce student paper plus answer key.</span></div>
          </div>
          <div className="output-action-stack">
            <button className="primary-action" disabled={!selectedQuestions.length}><FileText size={17} />Generate student paper</button>
            <button className="secondary-action" disabled={!selectedQuestions.length}><KeyRound size={17} />Generate answer key</button>
            <button className="secondary-action" disabled={!selectedQuestions.length}><FileText size={17} />Teacher version</button>
          </div>
          <div className="folder-table compact">
            <div className="folder-table-row"><strong>Mode</strong><span>{mode === "full_paper" ? "Full paper" : mode === "topic" ? "Topic based" : "Manual basket"}</span><small className="ok">Ready</small></div>
            <div className="folder-table-row"><strong>Pool</strong><span>{eligibleQuestions.length} eligible questions</span><small>{reviewPool}</small></div>
            <div className="folder-table-row"><strong>Answer key</strong><span>Correct options preserved for export</span><small className="ok">Planned</small></div>
          </div>
        </aside>
      </section>
    </>
  );
}
