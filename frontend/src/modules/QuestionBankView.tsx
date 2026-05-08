import { BookOpen, CheckCircle2, FileText, FolderOpen, Plus, Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { API_BASE, readJson } from "../api";
import type { AppSettingsPayload, MetadataDraft, QuestionBankRow, QuestionFilters, ReviewDraft, ReviewStatus } from "../types";
function StatusChip({ status }: { status: ReviewStatus }) {
  const className =
    status === "Needs review"
      ? "chip chip-warning"
      : status === "Reviewed"
        ? "chip chip-success"
        : "chip chip-muted";

  return (
    <span className={className}>
      <span className="chip-icon" aria-hidden="true">
        {status === "Needs review" ? <TriangleAlert size={13} /> : <CheckCircle2 size={13} />}
      </span>
      <span className="chip-text">{status}</span>
    </span>
  );
}
export function QuestionBankView({ initialSearch = "", onAddToExam }: { initialSearch?: string; onAddToExam?: (questionIds: number[]) => void }) {
  const [rows, setRows] = useState<QuestionBankRow[]>([]);
  const [filters, setFilters] = useState<QuestionFilters | null>(null);
  const [metadataTopics, setMetadataTopics] = useState<Array<{ topic_number: number | null; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [paper, setPaper] = useState("");
  const [questionNumber, setQuestionNumber] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicMode, setTopicMode] = useState<"any" | "all">("any");
  const [isTopicMenuOpen, setIsTopicMenuOpen] = useState(false);
  const [reviewStatus, setReviewStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [questionCount, setQuestionCount] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [questionReloadToken, setQuestionReloadToken] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [previewType, setPreviewType] = useState<"qp" | "ms">("qp");
  const [previewWidth, setPreviewWidth] = useState(450);
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, ReviewDraft>>({});
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(null);
  const [metadataTab, setMetadataTab] = useState<"details" | "topics" | "review">("review");
  const [isSavingReviews, setIsSavingReviews] = useState(false);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [isDeletingQuestions, setIsDeletingQuestions] = useState(false);
  const [deleteMsFiles, setDeleteMsFiles] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topicFilterRef = useRef<HTMLDivElement | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const changedReviewCount = Object.values(reviewDrafts).reduce((total, draft) => total + (draft.qp ? 1 : 0) + (draft.ms ? 1 : 0), 0);
  const metadataChanged = Boolean(
    selected
      && metadataDraft
      && (
        metadataDraft.marks !== (selected.marks === null ? "" : String(selected.marks))
        || metadataDraft.qpReviewStatus !== selected.qp_status_value
        || metadataDraft.msReviewStatus !== selected.ms_status_value
        || metadataDraft.reviewReason !== selected.review_reason
        || metadataDraft.topics.slice().sort().join("|") !== selected.topics.slice().sort().join("|")
      ),
  );

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    async function loadMetadataTopics() {
      const response = await fetch(`${API_BASE}/api/catalog/filters/`);
      const payload = await readJson<QuestionFilters>(response);
      setMetadataTopics(payload.topics);
    }
    loadMetadataTopics().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load metadata topics."));
  }, []);

  useEffect(() => {
    if (!selected) {
      setMetadataDraft(null);
      return;
    }
    setMetadataDraft({
      marks: selected.marks === null ? "" : String(selected.marks),
      topics: selected.topics,
      qpReviewStatus: selected.qp_status_value,
      msReviewStatus: selected.ms_status_value,
      reviewReason: selected.review_reason,
    });
  }, [selected?.id, selected?.marks, selected?.topics.join("|"), selected?.qp_status_value, selected?.ms_status_value, selected?.review_reason]);

  useEffect(() => {
    async function loadFilters() {
      const params = questionFilterParams({ includeTopics: false, includeQuestionNumber: false, includePagination: false });
      const response = await fetch(`${API_BASE}/api/catalog/filters/?${params.toString()}`);
      setFilters(await readJson<QuestionFilters>(response));
    }
    loadFilters().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load filters."));
  }, [paper, reviewStatus, search, topicMode]);

  useEffect(() => {
    if (!filters) return;
    setTopics((current) => current.filter((topicName) => filters.topics.some((item) => item.name === topicName)));
    if (questionNumber && !filters.question_numbers.includes(Number(questionNumber))) {
      setQuestionNumber("");
    }
  }, [filters, questionNumber]);

  useEffect(() => {
    async function loadQuestionBankPreferences() {
      const response = await fetch(`${API_BASE}/api/libraries/settings/`);
      const payload = await readJson<AppSettingsPayload>(response);
      const preferredPageSize = payload.app_preferences.question_bank.page_size;
      if ([10, 20, 50, 100].includes(preferredPageSize)) {
        setPageSize(preferredPageSize);
      }
      setTopicMode(payload.app_preferences.question_bank.topic_match_mode);
    }
    loadQuestionBankPreferences().catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = questionFilterParams();

    async function loadQuestions() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/catalog/questions/?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Question load failed with HTTP ${response.status}`);
        }
        const payload = await readJson<{ count: number; page: number; page_size: number; page_count: number; results: QuestionBankRow[] }>(response);
        setRows(payload.results);
        setQuestionCount(payload.count);
        setPageCount(payload.page_count);
        setSelectedId((current) => (current && payload.results.some((row) => row.id === current) ? current : (payload.results[0]?.id ?? null)));
        setSelectedQuestionIds((current) => current.filter((id) => payload.results.some((row) => row.id === id)));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load questions.");
      } finally {
        setIsLoading(false);
      }
    }

    loadQuestions();
  }, [paper, questionNumber, topics, topicMode, reviewStatus, search, page, questionReloadToken]);

  useEffect(() => {
    setPage(1);
  }, [paper, questionNumber, topics, topicMode, reviewStatus, search, pageSize]);

  useEffect(() => {
    if (!isTopicMenuOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && topicFilterRef.current?.contains(target)) return;
      setIsTopicMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsTopicMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTopicMenuOpen]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  function questionFilterParams(options: { includeTopics?: boolean; includeQuestionNumber?: boolean; includePagination?: boolean } = {}) {
    const includeTopics = options.includeTopics ?? true;
    const includeQuestionNumber = options.includeQuestionNumber ?? true;
    const includePagination = options.includePagination ?? true;
    const params = new URLSearchParams();
    if (paper) params.set("paper", paper);
    if (includeQuestionNumber && questionNumber) params.set("question_number", questionNumber);
    if (includeTopics) {
      topics.forEach((topicName) => params.append("topic", topicName));
    }
    params.set("topic_mode", topicMode);
    if (reviewStatus) params.set("review_status", reviewStatus);
    if (search) params.set("search", search);
    if (includePagination) {
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
    }
    return params;
  }

  async function markReviewed(documentType: "qp" | "ms" | "both") {
    if (!selected) return;
    const response = await fetch(`${API_BASE}/api/catalog/questions/${selected.id}/mark-reviewed/?document_type=${documentType}`);
    const updated = await readJson<QuestionBankRow>(response);
    setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setReviewDrafts((current) => {
      const next = { ...current };
      delete next[selected.id];
      return next;
    });
  }

  async function updateDocumentReviewStatusForQuestion(questionId: number, documentType: "qp" | "ms" | "both", status: "not_required" | "needs_review" | "reviewed") {
    const params = new URLSearchParams({ document_type: documentType, status });
    const response = await fetch(`${API_BASE}/api/catalog/questions/${questionId}/review-status/?${params.toString()}`);
    return readJson<QuestionBankRow>(response);
  }

  async function updateDocumentReviewStatus(documentType: "qp" | "ms" | "both", status: "not_required" | "needs_review" | "reviewed") {
    if (!selected) return;
    const updated = await updateDocumentReviewStatusForQuestion(selected.id, documentType, status);
    setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
  }

  function draftStatus(row: QuestionBankRow, documentType: "qp" | "ms") {
    const draft = reviewDrafts[row.id]?.[documentType];
    if (draft) return draft;
    return documentType === "qp" ? row.qp_status_value : row.ms_status_value;
  }

  function toggleReviewDraft(row: QuestionBankRow, documentType: "qp" | "ms") {
    const currentStatus = draftStatus(row, documentType);
    const nextStatus = currentStatus === "reviewed" ? "needs_review" : "reviewed";
    const originalStatus = documentType === "qp" ? row.qp_status_value : row.ms_status_value;

    setReviewDrafts((current) => {
      const next = { ...current };
      const nextDraft = { ...(next[row.id] ?? {}) };
      if (nextStatus === originalStatus) {
        delete nextDraft[documentType];
      } else {
        nextDraft[documentType] = nextStatus;
      }
      if (nextDraft.qp || nextDraft.ms) {
        next[row.id] = nextDraft;
      } else {
        delete next[row.id];
      }
      return next;
    });
  }

  function stageVisibleReview(documentType: "qp" | "ms" | "both", status: "needs_review" | "reviewed") {
    setReviewDrafts((current) => {
      const next = { ...current };
      rows.forEach((row) => {
        const documents = documentType === "both" ? (["qp", "ms"] as const) : ([documentType] as const);
        const nextDraft = { ...(next[row.id] ?? {}) };
        documents.forEach((document) => {
          const originalStatus = document === "qp" ? row.qp_status_value : row.ms_status_value;
          if (status === originalStatus) {
            delete nextDraft[document];
          } else {
            nextDraft[document] = status;
          }
        });
        if (nextDraft.qp || nextDraft.ms) {
          next[row.id] = nextDraft;
        } else {
          delete next[row.id];
        }
      });
      return next;
    });
  }

  function clearReviewDrafts() {
    setReviewDrafts({});
  }

  async function saveReviewDrafts() {
    setIsSavingReviews(true);
    setError(null);
    try {
      const updates = Object.entries(reviewDrafts).flatMap(([questionId, draft]) =>
        (["qp", "ms"] as const)
          .filter((documentType) => Boolean(draft[documentType]))
          .map((documentType) => updateDocumentReviewStatusForQuestion(Number(questionId), documentType, draft[documentType]!)),
      );
      const updatedRows = await Promise.all(updates);
      const latestById = new Map(updatedRows.map((row) => [row.id, row]));
      setRows((current) => current.map((row) => latestById.get(row.id) ?? row));
      setReviewDrafts({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save review changes.");
    } finally {
      setIsSavingReviews(false);
    }
  }

  async function openSelectedFile() {
    if (!selected) return;
    const response = await fetch(`${API_BASE}/api/catalog/questions/${selected.id}/open-file/?document_type=${previewType}`);
    const result = await readJson<{ ok: boolean; error?: string }>(response);
    if (!result.ok) {
      setError(result.error ?? "Could not open file.");
    }
  }

  async function openSelectedFolder() {
    if (!selected) return;
    const response = await fetch(`${API_BASE}/api/catalog/questions/${selected.id}/open-folder/?document_type=${previewType}`);
    const result = await readJson<{ ok: boolean; error?: string }>(response);
    if (!result.ok) {
      setError(result.error ?? "Could not open folder.");
    }
  }

  function toggleTopic(topicName: string) {
    setTopics((current) => (current.includes(topicName) ? current.filter((item) => item !== topicName) : [...current, topicName]));
  }

  function toggleMetadataTopic(topicName: string) {
    setMetadataDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        topics: current.topics.includes(topicName)
          ? current.topics.filter((item) => item !== topicName)
          : [...current.topics, topicName],
      };
    });
  }

  async function saveSelectedMetadata() {
    if (!selected || !metadataDraft) return;
    setIsSavingMetadata(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/catalog/questions/${selected.id}/metadata/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marks: metadataDraft.marks,
          topics: metadataDraft.topics,
          qp_review_status: metadataDraft.qpReviewStatus,
          ms_review_status: metadataDraft.msReviewStatus,
          review_reason: metadataDraft.reviewReason,
        }),
      });
      const updated = await readJson<QuestionBankRow>(response);
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setReviewDrafts((current) => {
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save metadata.");
    } finally {
      setIsSavingMetadata(false);
    }
  }

  async function deleteSelectedQuestions() {
    if (!selectedQuestionIds.length) return;
    const confirmed = window.confirm(
      `Delete ${selectedQuestionIds.length} selected question${selectedQuestionIds.length === 1 ? "" : "s"} from the Question Bank?\n\n${
        deleteMsFiles ? "The linked mark scheme PDF files will also be deleted from disk." : "The PDF files on disk will be kept."
      }`,
    );
    if (!confirmed) return;

    setIsDeletingQuestions(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/catalog/questions/delete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_ids: selectedQuestionIds, delete_ms_files: deleteMsFiles }),
      });
      const result = await readJson<{ ok: boolean; deleted_count: number; missing_ids: number[]; deleted_ms_files: number; failed_ms_files: Array<{ path: string; error: string }> }>(response);
      setRows((current) => current.filter((row) => !selectedQuestionIds.includes(row.id)));
      setSelectedQuestionIds([]);
      setQuestionCount((current) => Math.max(0, current - result.deleted_count));
      setSelectedId((current) => (current && selectedQuestionIds.includes(current) ? null : current));
      if (rows.length <= result.deleted_count && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        setQuestionReloadToken((current) => current + 1);
      }
      if (result.failed_ms_files.length) {
        setError(`Deleted ${result.deleted_count} question record(s), but ${result.failed_ms_files.length} mark scheme file(s) could not be deleted.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete selected questions.");
    } finally {
      setIsDeletingQuestions(false);
    }
  }

  function clearQuestionFilters() {
    setPaper("");
    setQuestionNumber("");
    setTopics([]);
    setTopicMode("any");
    setIsTopicMenuOpen(false);
    setReviewStatus("");
    setSearch("");
  }

  function toggleQuestionSelection(questionId: number) {
    setSelectedQuestionIds((current) => (current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId]));
  }

  function toggleVisibleSelection() {
    const visibleIds = rows.map((row) => row.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedQuestionIds.includes(id));
    setSelectedQuestionIds((current) => (allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds]))));
  }

  function startPreviewResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewWidth;
    function onMove(moveEvent: MouseEvent) {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      setPreviewWidth(Math.min(760, Math.max(340, nextWidth)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const selectedStatus = selected ? (previewType === "qp" ? selected.qp_status : selected.ms_status) : null;
  const selectedPages = selected ? (previewType === "qp" ? selected.qp_pages : selected.ms_pages) : [null, null];

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">Question Bank</p>
          <h1>Browse split questions</h1>
        </div>
      </section>

      <section className="filterbar">
        <div className="segmented">
          <button className={!paper ? "selected" : ""} onClick={() => setPaper("")}>All</button>
          {filters?.papers.map((paperNumber) => (
            <button className={paper === String(paperNumber) ? "selected" : ""} key={paperNumber} onClick={() => setPaper(String(paperNumber))}>
              Paper{paperNumber}
            </button>
          ))}
        </div>

        <select className="filter-select" value={questionNumber} onChange={(event) => setQuestionNumber(event.target.value)}>
          <option value="">All questions</option>
          {filters?.question_numbers.map((number) => <option key={number} value={number}>Q{number}</option>)}
        </select>
        <div className={isTopicMenuOpen ? "topic-filter open" : "topic-filter"} ref={topicFilterRef}>
          <div
            className="topic-filter-head"
            role="button"
            tabIndex={0}
            aria-expanded={isTopicMenuOpen}
            onClick={() => setIsTopicMenuOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setIsTopicMenuOpen((current) => !current);
              }
            }}
          >
            <span>{topics.length ? `${topics.length} topic${topics.length === 1 ? "" : "s"}` : "All topics"}</span>
            <div className="mini-toggle" onClick={(event) => event.stopPropagation()}>
              <button className={topicMode === "any" ? "selected" : ""} onClick={() => { setTopicMode("any"); setIsTopicMenuOpen(true); }}>Match any</button>
              <button className={topicMode === "all" ? "selected" : ""} onClick={() => { setTopicMode("all"); setIsTopicMenuOpen(true); }}>Match all</button>
            </div>
          </div>
          {isTopicMenuOpen ? (
            <div className="topic-menu">
              {filters?.topics.map((item) => (
                <label key={`${item.topic_number}-${item.name}`}>
                  <input type="checkbox" checked={topics.includes(item.name)} onChange={() => toggleTopic(item.name)} />
                  {item.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <select className="filter-select" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
          <option value="">Any review</option>
          {filters?.review_statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
        <label className="table-search">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Exam code" />
        </label>
        <button className="icon-button" aria-label="Clear filters" title="Clear filters" onClick={clearQuestionFilters}>
          <SlidersHorizontal size={18} />
        </button>
      </section>

      <div className="main-grid" style={{ gridTemplateColumns: `minmax(0, 1fr) ${previewWidth}px` }}>
        <section className="table-panel question-results-panel">
          <div className="panel-title">
            <div>
              <strong>Results</strong>
              <span>
                {isLoading ? "Loading..." : `${questionCount} questions found / showing ${rows.length}`}
                {changedReviewCount ? ` / ${changedReviewCount} review changes` : ""}
              </span>
            </div>
            <div className="table-actions">
              <div className="action-group action-group-exam">
                <button className="primary-action" disabled={!selectedQuestionIds.length || !onAddToExam} onClick={() => onAddToExam?.(selectedQuestionIds)}>
                  <Plus size={16} />
                  {selectedQuestionIds.length ? `Add ${selectedQuestionIds.length} to exam` : "Add selected to exam"}
                </button>
              </div>
              <div className="action-group action-group-review">
                <button className="ghost-button" disabled={!rows.length} onClick={() => stageVisibleReview("qp", "reviewed")}>
                  Mark visible QP
                </button>
                <button className="ghost-button" disabled={!rows.length} onClick={() => stageVisibleReview("ms", "reviewed")}>
                  Mark visible MS
                </button>
                <button className="ghost-button" disabled={!rows.length} onClick={() => stageVisibleReview("both", "reviewed")}>
                  Mark visible both
                </button>
              </div>
              <div className="action-group action-group-save">
                <button className="ghost-button" disabled={!changedReviewCount || isSavingReviews} onClick={clearReviewDrafts}>
                  Clear changes
                </button>
                <button className="primary-action" disabled={!changedReviewCount || isSavingReviews} onClick={saveReviewDrafts}>
                  {isSavingReviews ? "Saving..." : changedReviewCount ? `Save (${changedReviewCount})` : "Save"}
                </button>
              </div>
              <div className="action-group action-group-delete">
                <label className="delete-file-option">
                  <input type="checkbox" checked={deleteMsFiles} onChange={(event) => setDeleteMsFiles(event.target.checked)} />
                  Delete MS PDFs too
                </label>
                <button className="ghost-button danger-action" disabled={!selectedQuestionIds.length || isDeletingQuestions} onClick={deleteSelectedQuestions}>
                  {isDeletingQuestions ? "Deleting..." : selectedQuestionIds.length ? `Delete ${selectedQuestionIds.length}` : "Delete selected"}
                </button>
              </div>
            </div>
          </div>
          {error ? <div className="callout error">{error}</div> : null}

          <div className="results-table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th className="col-select">
                    <input
                      type="checkbox"
                      aria-label="Select visible questions"
                      checked={rows.length > 0 && rows.every((row) => selectedQuestionIds.includes(row.id))}
                      onChange={toggleVisibleSelection}
                    />
                  </th>
                  <th className="col-paper">Paper</th>
                  <th className="col-question">Question</th>
                  <th className="col-exam">Exam</th>
                  <th className="col-topics">Topics</th>
                  <th className="col-marks">Marks</th>
                  <th className="col-status">QP reviewed</th>
                  <th className="col-status">MS reviewed</th>
                  <th className="col-reviewed">Last reviewed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className={selected?.id === row.id ? "selected-row" : ""} key={row.id} onClick={() => setSelectedId(row.id)}>
                    <td className="col-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.exam} ${row.question}`}
                        checked={selectedQuestionIds.includes(row.id)}
                        onChange={(event) => {
                          event.stopPropagation();
                          toggleQuestionSelection(row.id);
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td>{row.paper}</td>
                    <td>{row.question}</td>
                    <td className="mono">{row.exam}</td>
                    <td>
                      <div className="topic-list" title={row.topics.length ? row.topics.join(", ") : "No topics"}>
                        {row.topics.length ? row.topics.map((topic) => <span key={topic} title={topic}>{topic}</span>) : <em>No topics</em>}
                      </div>
                    </td>
                    <td>{row.marks ?? "-"}</td>
                    <td>
                      <label className={reviewDrafts[row.id]?.qp ? "review-checkbox changed" : "review-checkbox"}>
                        <input type="checkbox" checked={draftStatus(row, "qp") === "reviewed"} onChange={() => toggleReviewDraft(row, "qp")} />
                        <StatusChip status={reviewDrafts[row.id]?.qp ? (reviewDrafts[row.id].qp === "reviewed" ? "Reviewed" : "Needs review") : row.qp_status} />
                      </label>
                    </td>
                    <td>
                      <label className={reviewDrafts[row.id]?.ms ? "review-checkbox changed" : "review-checkbox"}>
                        <input type="checkbox" checked={draftStatus(row, "ms") === "reviewed"} onChange={() => toggleReviewDraft(row, "ms")} />
                        <StatusChip status={reviewDrafts[row.id]?.ms ? (reviewDrafts[row.id].ms === "reviewed" ? "Reviewed" : "Needs review") : row.ms_status} />
                      </label>
                    </td>
                    <td>{row.review_reason ? "Review note" : "No note"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-pagination">
            <span>
              Page {page} of {pageCount}
            </span>
            <div>
              <label>
                Rows
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <button className="ghost-button" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Previous
              </button>
              <button className="ghost-button" disabled={page >= pageCount || isLoading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                Next
              </button>
            </div>
          </div>
        </section>

        <aside className="preview-panel resizable-preview">
          <div className="resize-handle" onMouseDown={startPreviewResize} title="Drag to resize preview" />
          <div className="preview-tabs">
            <button className={previewType === "qp" ? "active" : ""} onClick={() => setPreviewType("qp")}>Question</button>
            <button className={previewType === "ms" ? "active" : ""} onClick={() => setPreviewType("ms")}>Mark scheme</button>
          </div>

          <div className="pdf-preview">
            {selected ? (
              <iframe
                className="pdf-frame"
                src={`${API_BASE}/api/catalog/questions/${selected.id}/file/${previewType}/`}
                title={`${selected.exam} ${selected.question} ${previewType}`}
              />
            ) : (
              <div className="pdf-page">
                <div className="pdf-header">No question selected</div>
                <div className="pdf-line long" />
                <div className="pdf-line" />
                <div className="pdf-box" />
                <div className="pdf-line long" />
                <div className="pdf-line short" />
                <div className="pdf-grid" />
              </div>
            )}
          </div>

          <div className="preview-details">
            <h2>{selected ? `${selected.exam}_${selected.question}_${previewType.toUpperCase()}.pdf` : "No question selected"}</h2>
            <p>
              {selected
                ? `${selected.paper} / ${selected.question} / ${selected.marks ?? "-"} marks / pages ${selectedPages[0] ?? "-"}-${selectedPages[1] ?? "-"}`
                : "Select a row to view details"}
            </p>

            {selected ? (
              <div className="review-workflow">
                <div className={previewType === "qp" ? "review-card active" : "review-card"}>
                  <div>
                    <strong>Question PDF</strong>
                    <span>Pages {selected.qp_pages[0] ?? "-"}-{selected.qp_pages[1] ?? "-"}</span>
                  </div>
                  <StatusChip status={selected.qp_status} />
                </div>
                <div className={previewType === "ms" ? "review-card active" : "review-card"}>
                  <div>
                    <strong>Mark scheme PDF</strong>
                    <span>Pages {selected.ms_pages[0] ?? "-"}-{selected.ms_pages[1] ?? "-"}</span>
                  </div>
                  <StatusChip status={selected.ms_status} />
                </div>
              </div>
            ) : null}

            {selected && metadataDraft ? (
              <div className="metadata-editor">
                <div className="metadata-header">
                  <span className="metadata-header-icon"><BookOpen size={16} /></span>
                  <div>
                    <strong>Question metadata</strong>
                    <span>Edit the selected question without leaving the bank</span>
                  </div>
                </div>

                <div className="metadata-tabs">
                  <button className={metadataTab === "details" ? "active" : ""} onClick={() => setMetadataTab("details")}>Details</button>
                  <button className={metadataTab === "topics" ? "active" : ""} onClick={() => setMetadataTab("topics")}>Topics</button>
                  <button className={metadataTab === "review" ? "active" : ""} onClick={() => setMetadataTab("review")}>Review</button>
                </div>

                {metadataTab === "details" ? (
                  <div className="metadata-tab-panel metadata-details-panel">
                    <div className="metadata-readonly-grid">
                      <div><span>Exam</span><strong>{selected.exam}</strong></div>
                      <div><span>Paper</span><strong>{selected.paper}</strong></div>
                      <div><span>Question</span><strong>{selected.question}</strong></div>
                      <label className="metadata-marks-field">
                        <span>Marks</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={metadataDraft.marks}
                          onChange={(event) => setMetadataDraft((current) => current ? { ...current, marks: event.target.value } : current)}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {metadataTab === "topics" ? (
                  <div className="metadata-tab-panel metadata-topic-editor">
                    <div>
                      <strong>Topics</strong>
                      <span>{metadataDraft.topics.length ? `${metadataDraft.topics.length} selected` : "No topics assigned"}</span>
                    </div>
                    <div className="metadata-topic-list">
                      {metadataTopics.map((topic) => (
                        <label key={`${topic.topic_number}-${topic.name}`}>
                          <input
                            type="checkbox"
                            checked={metadataDraft.topics.includes(topic.name)}
                            onChange={() => toggleMetadataTopic(topic.name)}
                          />
                          {topic.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {metadataTab === "review" ? (
                  <div className="metadata-tab-panel metadata-review-panel">
                    <div className="metadata-review-row">
                      <div>
                        <strong>Question PDF (QP)</strong>
                        <span>Review the question PDF if needed</span>
                      </div>
                      <select
                        value={metadataDraft.qpReviewStatus}
                        onChange={(event) => setMetadataDraft((current) => current ? { ...current, qpReviewStatus: event.target.value } : current)}
                      >
                        <option value="not_required">Not required</option>
                        <option value="needs_review">Needs review</option>
                        <option value="reviewed">Reviewed</option>
                      </select>
                    </div>
                    <div className="metadata-review-row">
                      <div>
                        <strong>Mark scheme (MS)</strong>
                        <span>Review the mark scheme status</span>
                      </div>
                      <select
                        value={metadataDraft.msReviewStatus}
                        onChange={(event) => setMetadataDraft((current) => current ? { ...current, msReviewStatus: event.target.value } : current)}
                      >
                        <option value="not_required">Not required</option>
                        <option value="needs_review">Needs review</option>
                        <option value="reviewed">Reviewed</option>
                      </select>
                    </div>
                    <label className="field-block metadata-review-note">
                      <span>Review notes</span>
                      <textarea
                        value={metadataDraft.reviewReason}
                        onChange={(event) => setMetadataDraft((current) => current ? { ...current, reviewReason: event.target.value } : current)}
                        placeholder="Add review notes, feedback, or instructions..."
                      />
                    </label>
                  </div>
                ) : null}

                <div className="metadata-actions">
                  <button
                    className="ghost-button"
                    disabled={!metadataChanged || isSavingMetadata}
                    onClick={() => setMetadataDraft({
                      marks: selected.marks === null ? "" : String(selected.marks),
                      topics: selected.topics,
                      qpReviewStatus: selected.qp_status_value,
                      msReviewStatus: selected.ms_status_value,
                      reviewReason: selected.review_reason,
                    })}
                  >
                    Reset
                  </button>
                  <button className="primary-action" disabled={!metadataChanged || isSavingMetadata} onClick={saveSelectedMetadata}>
                    {isSavingMetadata ? "Saving..." : "Save metadata"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="actions review-actions">
              <button className="secondary-action" disabled={!selected} onClick={openSelectedFile}>
                <FileText size={16} />
                Open file
              </button>
              <button className="secondary-action" disabled={!selected} onClick={openSelectedFolder}>
                <FolderOpen size={16} />
                Open folder
              </button>
              <button className="secondary-action" disabled={!selected || selectedStatus === "Reviewed"} onClick={() => markReviewed(previewType)}>
                Mark current reviewed
              </button>
              <button className="secondary-action" disabled={!selected || (selected?.qp_status === "Reviewed" && selected?.ms_status === "Reviewed")} onClick={() => markReviewed("both")}>
                Mark both reviewed
              </button>
              <button className="secondary-action warning-action" disabled={!selected || selectedStatus === "Needs review"} onClick={() => updateDocumentReviewStatus(previewType, "needs_review")}>
                Send current to review
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}



