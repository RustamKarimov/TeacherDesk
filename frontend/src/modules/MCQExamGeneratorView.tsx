import { ClipboardList, Dice5, FileText, FolderOpen, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQMetadataPayload, MCQQuestionListPayload, MCQQuestionRow, MCQReviewStatus } from "../types";

type GeneratorMode = "full_paper" | "topic" | "manual";
type TopicRow = { id: string; topicIds: number[]; tagIds: number[]; count: number };
type GeneratedPayload = {
  output_folder: string;
  question_count: number;
  total_marks: number;
  variants: Array<{ variant: number; student_pdf: string; teacher_pdf: string; answer_key_pdf: string }>;
  warnings: Array<{ message: string; row?: number; requested?: number; available?: number }>;
};
type HeaderFooterDraft = {
  header: { left: string; center: string; right: string };
  footer: { left: string; center: string; right: string };
};

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

function matchesRow(question: MCQQuestionRow, row: TopicRow) {
  return row.topicIds.every((topicId) => question.topics.some((topic) => topic.id === topicId))
    && row.tagIds.every((tagId) => question.tags.some((tag) => tag.id === tagId));
}

function MultiPicker({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  options: Array<{ id: number; name: string }>;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selectedNames = options.filter((item) => selectedIds.includes(item.id)).map((item) => item.name);
  useEffect(() => {
    function close(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  function toggle(id: number) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }
  return (
    <div className={`multi-filter compact-picker ${open ? "open" : ""}`} ref={ref}>
      <button className="multi-filter-trigger" onClick={() => setOpen((current) => !current)} type="button">
        <span>{label}</span>
        <strong>{selectedNames.length ? `${selectedNames.length} selected` : `Any ${label.toLowerCase()}`}</strong>
      </button>
      {open ? (
        <div className="multi-filter-menu compact-picker-menu">
          <div className="multi-filter-actions">
            <button type="button" onClick={() => onChange(options.map((item) => item.id))}>All</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="multi-filter-list">
            {options.map((item) => (
              <label key={item.id}>
                <input checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} type="checkbox" />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MCQExamGeneratorView({
  manualQuestionIds = [],
  onManualQuestionsConsumed,
  onOpenQuestionBank,
}: {
  manualQuestionIds?: number[];
  onManualQuestionsConsumed?: () => void;
  onOpenQuestionBank?: () => void;
}) {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [questions, setQuestions] = useState<MCQQuestionRow[]>([]);
  const [mode, setMode] = useState<GeneratorMode>(manualQuestionIds.length ? "manual" : "full_paper");
  const [title, setTitle] = useState("New MCQ paper");
  const [questionCount, setQuestionCount] = useState(40);
  const [topicRows, setTopicRows] = useState<TopicRow[]>([{ id: crypto.randomUUID(), topicIds: [], tagIds: [], count: 3 }]);
  const [reviewPool, setReviewPool] = useState<"ready" | "all">("ready");
  const [selectedIds, setSelectedIds] = useState<number[]>(manualQuestionIds);
  const [previewIds, setPreviewIds] = useState<number[]>(manualQuestionIds);
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const [metadataPosition, setMetadataPosition] = useState<"above" | "below">("below");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [variants, setVariants] = useState(1);
  const [generated, setGenerated] = useState<GeneratedPayload | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterDraft>({
    header: { left: "", center: "{title}", right: "" },
    footer: { left: "{date}", center: "Page {page} of {pages}", right: "Variant {variant}" },
  });
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

  function topicalPreview(rows = topicRows) {
    const picked: MCQQuestionRow[] = [];
    const used = new Set<number>();
    rows.forEach((row) => {
      const matches = shuffleRows(eligibleQuestions.filter((question) => !used.has(question.id) && matchesRow(question, row))).slice(0, row.count);
      matches.forEach((question) => used.add(question.id));
      picked.push(...matches);
    });
    return picked;
  }

  function generatePreview() {
    const picked = mode === "manual"
      ? selectedIds.map((id) => questions.find((row) => row.id === id)).filter((row): row is MCQQuestionRow => Boolean(row))
      : mode === "topic"
        ? topicalPreview()
        : pickFullPaper(eligibleQuestions, questionCount);
    const finalRows = shuffleQuestions ? shuffleRows(picked) : picked;
    setPreviewIds(finalRows.map((row) => row.id));
    setNotice(`${finalRows.length} questions prepared for preview.`);
  }

  function updateTopicRow(id: string, patch: Partial<TopicRow>) {
    setTopicRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addTopicRow() {
    setTopicRows((current) => [...current, { id: crypto.randomUUID(), topicIds: [], tagIds: [], count: 1 }]);
  }

  function removePreviewQuestion(questionId: number) {
    setPreviewIds((current) => current.filter((id) => id !== questionId));
    setSelectedIds((current) => current.filter((id) => id !== questionId));
  }

  async function generatePdfs() {
    setError(null);
    setNotice("Preparing MCQ PDFs. Images, tables, answer keys, and variants are being rendered...");
    setIsGenerating(true);
    const payload = {
      title,
      mode,
      question_count: questionCount,
      review_pool: reviewPool,
      selected_question_ids: mode === "manual" ? previewIds : selectedQuestions.map((row) => row.id),
      topic_rows: topicRows.map((row) => ({ topic_ids: row.topicIds, tag_ids: row.tagIds, count: row.count })),
      include_metadata: includeMetadata,
      metadata_position: metadataPosition,
      shuffle_questions: shuffleQuestions,
      shuffle_options: shuffleOptions,
      variants,
      header_footer: headerFooter,
    };
    try {
      const response = await fetch(`${API_BASE}/api/mcq/exams/generate/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await readJson<GeneratedPayload>(response);
      setGenerated(result);
      setNotice(`Generated ${result.variants.length} variant${result.variants.length === 1 ? "" : "s"} in ${result.output_folder}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate MCQ PDFs.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function openOutputFolder() {
    if (!generated?.output_folder) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/exams/open-folder/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: generated.output_folder }),
      });
      await readJson(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open generated exam folder.");
    }
  }

  function updateHeaderFooter(area: "header" | "footer", position: "left" | "center" | "right", value: string) {
    setHeaderFooter((current) => ({ ...current, [area]: { ...current[area], [position]: value } }));
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Exam Generator</h1>
          <span className="header-subtitle">Generate variants, answer keys, teacher versions, and metadata-aware MCQ exams.</span>
        </div>
      </section>

      <section className="mcq-generator-grid">
        <div className="panel mcq-generator-main">
          {error ? <div className="callout error">{error}</div> : null}
          {notice ? <div className="callout success">{notice}</div> : null}

          <div className="mcq-generator-card">
            <div className="dashboard-widget-head">
              <div><strong>Paper setup</strong><span>Choose the mode, variants, shuffling, and metadata display.</span></div>
            </div>
            <div className="mcq-generator-fields extended">
              <label className="field-stack"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="field-stack"><span>Questions</span><input min={1} max={100} type="number" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value) || 1)} /></label>
              <label className="field-stack"><span>Variants</span><input min={1} max={10} type="number" value={variants} onChange={(event) => setVariants(Math.min(Math.max(Number(event.target.value) || 1, 1), 10))} /></label>
              <label className="field-stack"><span>Question pool</span><select value={reviewPool} onChange={(event) => setReviewPool(event.target.value as "ready" | "all")}><option value="ready">Ready and verified only</option><option value="all">All questions</option></select></label>
            </div>

            <div className="mode-card-grid">
              <button className={mode === "full_paper" ? "active" : ""} onClick={() => setMode("full_paper")} type="button"><Dice5 size={19} /><strong>Full paper</strong><span>One random question per original question number.</span></button>
              <button className={mode === "topic" ? "active" : ""} onClick={() => setMode("topic")} type="button"><ClipboardList size={19} /><strong>Topic based</strong><span>Rows with topic and tag rules.</span></button>
              <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")} type="button"><Plus size={19} /><strong>Manual basket</strong><span>Use questions sent from the MCQ bank.</span></button>
            </div>

            <div className="generator-options-strip">
              <label><input checked={includeMetadata} onChange={(event) => setIncludeMetadata(event.target.checked)} type="checkbox" /> Show source metadata</label>
              <select disabled={!includeMetadata} value={metadataPosition} onChange={(event) => setMetadataPosition(event.target.value as "above" | "below")}><option value="above">Above question</option><option value="below">Below question</option></select>
              <label><input checked={shuffleQuestions} onChange={(event) => setShuffleQuestions(event.target.checked)} type="checkbox" /> Shuffle questions</label>
              <label><input checked={shuffleOptions} onChange={(event) => setShuffleOptions(event.target.checked)} type="checkbox" /> Shuffle options</label>
            </div>

            {mode === "topic" ? (
              <div className="topic-row-builder">
                <div className="dashboard-widget-head">
                  <div><strong>Topical rows</strong><span>Each row can request a different count with its own topic and tag rules.</span></div>
                  <button className="secondary-action compact-action" onClick={addTopicRow}><Plus size={15} />Add row</button>
                </div>
                {topicRows.map((row, index) => {
                  const available = eligibleQuestions.filter((question) => matchesRow(question, row)).length;
                  return (
                    <div className="topic-rule-row" key={row.id}>
                      <span className="order-badge">{index + 1}</span>
                      <MultiPicker label="Topics" options={metadata?.topics ?? []} selectedIds={row.topicIds} onChange={(ids) => updateTopicRow(row.id, { topicIds: ids })} />
                      <MultiPicker label="Tags" options={metadata?.tags ?? []} selectedIds={row.tagIds} onChange={(ids) => updateTopicRow(row.id, { tagIds: ids })} />
                      <label className={`count-filter-field ${available < row.count ? "warning" : ""}`}>
                        <span>Needed</span>
                        <input min={1} max={available || 1} type="number" value={row.count} onChange={(event) => updateTopicRow(row.id, { count: Number(event.target.value) || 1 })} />
                        <em>{available} available</em>
                      </label>
                      <button className="toolbar-icon-button danger-icon" disabled={topicRows.length === 1} onClick={() => setTopicRows((current) => current.filter((item) => item.id !== row.id))} title="Remove row"><Trash2 size={16} /></button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {mode === "manual" ? (
              <div className="manual-basket-panel">
                <strong>{selectedIds.length} questions in manual basket</strong>
                <button className="secondary-action compact-action" onClick={onOpenQuestionBank}><FolderOpen size={15} />Update selection in Question Bank</button>
              </div>
            ) : null}

            <div className="header-footer-panel">
              <div className="section-intro compact"><strong>Header and footer</strong><span>Use tokens: {"{title}"}, {"{page}"}, {"{pages}"}, {"{date}"}, {"{variant}"}, {"{mode}"}.</span></div>
              {(["header", "footer"] as const).map((area) => (
                <div className="header-footer-row" key={area}>
                  <strong>{area === "header" ? "Header" : "Footer"}</strong>
                  {(["left", "center", "right"] as const).map((position) => (
                    <label className="field-stack compact-field" key={`${area}-${position}`}>
                      <span>{position}</span>
                      <input value={headerFooter[area][position]} onChange={(event) => updateHeaderFooter(area, position, event.target.value)} placeholder={`${area} ${position}`} />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mcq-generator-card">
            <div className="dashboard-widget-head">
              <div><strong>Selected questions ({selectedQuestions.length})</strong><span>{totalMarks} marks. Questions appear in the current preview order.</span></div>
              <button className="secondary-action compact-action" onClick={generatePreview}><RefreshCw size={15} />{selectedQuestions.length ? "Refresh" : "Generate preview"}</button>
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
            <div><strong>Output</strong><span>PDF generation creates every variant, answer key, and teacher copy in one folder.</span></div>
          </div>
          <div className="output-action-stack">
            <button className="primary-action" disabled={isGenerating || (!selectedQuestions.length && mode === "manual")} onClick={generatePdfs}><FileText size={17} />{isGenerating ? "Generating PDFs..." : "Generate PDFs"}</button>
            <button className="secondary-action" disabled><KeyRound size={17} />Answer key is automatic</button>
            <button className="secondary-action" disabled={!generated?.output_folder || isGenerating} onClick={openOutputFolder}><FolderOpen size={17} />Open output folder</button>
          </div>
          <div className="folder-table compact">
            <div className="folder-table-row"><strong>Mode</strong><span>{mode === "full_paper" ? "Full paper" : mode === "topic" ? "Topic based" : "Manual basket"}</span><small className="ok">Ready</small></div>
            <div className="folder-table-row"><strong>Pool</strong><span>{eligibleQuestions.length} eligible questions</span><small>{reviewPool}</small></div>
            <div className="folder-table-row"><strong>Variants</strong><span>{variants} paper set{variants === 1 ? "" : "s"}</span><small className="ok">Ready</small></div>
          </div>
          {generated ? (
            <div className="generated-output-card">
              <strong>Generated in</strong>
              <span>{generated.output_folder}</span>
              {generated.variants.map((variant) => <small key={variant.variant}>Variant {variant.variant}: student, teacher, and answer key PDFs ready</small>)}
            </div>
          ) : null}
        </aside>
      </section>
    </>
  );
}
