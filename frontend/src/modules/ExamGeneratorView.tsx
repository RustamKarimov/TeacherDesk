import { ArrowDown, ArrowUp, Database, FileText, Plus, RefreshCw, Search, Shuffle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { API_BASE, readJson } from "../api";
import { MaskSettingRow } from "../components/MaskSettingRow";
import type {
  AppSettingsPayload,
  ExamAvailability,
  ExamMode,
  GeneratedExamPreview,
  GeneratedQuestion,
  PdfMaskSettings,
  QuestionFilters,
  SavedExamDraft,
  TopicRuleRow,
} from "../types";

export function ExamGeneratorView({
  manualQuestionIds = [],
  onManualQuestionsConsumed,
  onOpenQuestionBank,
}: {
  manualQuestionIds?: number[];
  onManualQuestionsConsumed?: () => void;
  onOpenQuestionBank?: () => void;
}) {
  const [filters, setFilters] = useState<QuestionFilters | null>(null);
  const [paperOptions, setPaperOptions] = useState<number[]>([]);
  const [paper, setPaper] = useState("2");
  const [mode, setMode] = useState<ExamMode>("full_paper");
  const [targetMarks, setTargetMarks] = useState("60");
  const [tolerance, setTolerance] = useState("4");
  const [questionNumbers, setQuestionNumbers] = useState("1-6");
  const [topicRows, setTopicRows] = useState<TopicRuleRow[]>([{ id: 1, requiredTopics: [], allowedTopics: [], count: 1 }]);
  const [draftTitle, setDraftTitle] = useState("New generated exam");
  const [outputFolder, setOutputFolder] = useState(String.raw`D:\Programming\School Projects\CambridgeProjects\TeacherDesk\local_library\generated_exams`);
  const [includeMarkScheme, setIncludeMarkScheme] = useState(true);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftStatusFilter, setDraftStatusFilter] = useState("all");
  const [selectedDraftIds, setSelectedDraftIds] = useState<number[]>([]);
  const [isDeletingDrafts, setIsDeletingDrafts] = useState(false);
  const [examMaskSettings, setExamMaskSettings] = useState<PdfMaskSettings>({
    qp_header_enabled: false,
    qp_footer_enabled: false,
    ms_header_enabled: false,
    ms_footer_enabled: false,
    qp_header_mm: 18,
    qp_footer_mm: 16,
    ms_header_mm: 10,
    ms_footer_mm: 22,
  });
  const [preview, setPreview] = useState<GeneratedExamPreview | null>(null);
  const [savedDraft, setSavedDraft] = useState<SavedExamDraft | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<SavedExamDraft[]>([]);
  const [availability, setAvailability] = useState<ExamAvailability>({});
  const [pdfOutput, setPdfOutput] = useState<{ exam_pdf_path: string; markscheme_pdf_path: string; output_folder?: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isGeneratingPdfs, setIsGeneratingPdfs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topicNames = filters?.topics.map((topic) => topic.name) ?? [];
  const manualSelectionKey = manualQuestionIds.join(",");
  const previewQuestions = preview?.questions ?? [];
  const totalPagesEstimate = Math.max(previewQuestions.length * 2, 0);
  const reviewBreakdown = previewQuestions.reduce(
    (summary, question) => {
      if (question.qp_status === "Needs review" || question.ms_status === "Needs review") summary.needsReview += 1;
      else summary.notRequired += 1;
      if (!question.marks) summary.missing += 1;
      return summary;
    },
    { notRequired: 0, needsReview: 0, missing: 0 },
  );
  const filteredDrafts = savedDrafts.filter((draft) => {
    const matchesSearch = `${draft.title} ${draft.mode}`.toLowerCase().includes(draftSearch.toLowerCase());
    const status = draft.exam_pdf_path ? "ready" : "draft";
    return matchesSearch && (draftStatusFilter === "all" || draftStatusFilter === status);
  });
  const visibleDrafts = filteredDrafts.slice(0, 8);

  async function loadSavedDrafts() {
    const response = await fetch(`${API_BASE}/api/exams/drafts/`);
    const payload = await readJson<{ count: number; results: SavedExamDraft[] }>(response);
    setSavedDrafts(payload.results);
    setSelectedDraftIds((current) => current.filter((id) => payload.results.some((draft) => draft.id === id)));
  }

  useEffect(() => {
    loadSavedDrafts().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load saved drafts."));
  }, []);

  useEffect(() => {
    async function loadAppSettings() {
      const response = await fetch(`${API_BASE}/api/libraries/settings/`);
      const settings = await readJson<AppSettingsPayload>(response);
      if (settings.default_generated_exams_root) {
        setOutputFolder(settings.default_generated_exams_root);
      }
      setExamMaskSettings(settings.pdf_mask_settings);
      setPaper(settings.app_preferences.exam_generator.default_paper);
      setMode(settings.app_preferences.exam_generator.default_mode);
      setTolerance(String(settings.app_preferences.exam_generator.allowed_over_target));
      setIncludeMarkScheme(settings.app_preferences.exam_generator.include_markscheme);
      const marks = settings.paper_marks?.[paper];
      if (marks && mode === "full_paper") {
        setTargetMarks(String(marks));
      }
    }
    loadAppSettings().catch(() => undefined);
  }, []);

  useEffect(() => {
    async function syncPaperMarks() {
      const response = await fetch(`${API_BASE}/api/libraries/settings/`);
      const settings = await readJson<AppSettingsPayload>(response);
      const marks = settings.paper_marks?.[paper];
      if (marks && mode === "full_paper") {
        setTargetMarks(String(marks));
      }
    }
    syncPaperMarks().catch(() => undefined);
  }, [paper, mode]);

  useEffect(() => {
    async function loadAvailability() {
      if (mode === "manual") {
        setAvailability({});
        return;
      }
      const payload =
        mode === "question_numbers"
          ? { mode, paper_number: Number(paper), question_numbers: questionNumbers }
          : mode === "topics"
            ? {
                mode,
                paper_number: Number(paper),
                topic_rows: topicRows.map((row) => ({
                  required_topics: row.requiredTopics,
                  allowed_topics: row.allowedTopics,
                })),
              }
            : { mode, paper_number: Number(paper) };
      const response = await fetch(`${API_BASE}/api/exams/availability/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setAvailability(await readJson<ExamAvailability>(response));
    }
    loadAvailability().catch(() => setAvailability({}));
  }, [mode, paper, questionNumbers, topicRows]);

  useEffect(() => {
    if (!manualQuestionIds.length) return;

    async function loadManualSelection() {
      setIsGenerating(true);
      setError(null);
      setSavedDraft(null);
      setPdfOutput(null);
      setMode("manual");
      try {
        const response = await fetch(`${API_BASE}/api/exams/generate/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "manual", question_ids: manualQuestionIds }),
        });
        const nextPreview = await readJson<GeneratedExamPreview>(response);
        setPreview(nextPreview);
        const papers = Array.from(new Set(nextPreview.questions.map((question) => question.paper))).join(", ");
        setDraftTitle(`Selected questions${papers ? ` - ${papers}` : ""}`);
        onManualQuestionsConsumed?.();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not add selected questions.");
      } finally {
        setIsGenerating(false);
      }
    }

    loadManualSelection();
  }, [manualSelectionKey]);

  useEffect(() => {
    async function loadPaperOptions() {
      const response = await fetch(`${API_BASE}/api/catalog/filters/`);
      const nextFilters = await readJson<QuestionFilters>(response);
      setPaperOptions(nextFilters.papers);
      if (paper && !nextFilters.papers.includes(Number(paper))) {
        setPaper(String(nextFilters.papers[0] ?? ""));
      }
    }
    loadPaperOptions().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load available papers."));
  }, [paper]);

  useEffect(() => {
    async function loadFilters() {
      const params = new URLSearchParams();
      if (paper) params.set("paper", paper);
      const response = await fetch(`${API_BASE}/api/catalog/filters/?${params.toString()}`);
      const nextFilters = await readJson<QuestionFilters>(response);
      setFilters(nextFilters);
      setTopicRows((current) =>
        current.map((row) => {
          const names = nextFilters.topics.map((topic) => topic.name);
          return {
            ...row,
            requiredTopics: row.requiredTopics.filter((topic) => names.includes(topic)),
            allowedTopics: row.allowedTopics.length ? row.allowedTopics.filter((topic) => names.includes(topic)) : names,
          };
        }),
      );
    }
    loadFilters().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load exam generator filters."));
  }, [paper]);

  function addTopicRow() {
    setTopicRows((current) => [...current, { id: Date.now(), requiredTopics: [], allowedTopics: topicNames, count: 1 }]);
  }

  function updateTopicRow(id: number, update: Partial<TopicRuleRow>) {
    setTopicRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  }

  function removeTopicRow(id: number) {
    setTopicRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  }

  function toggleTopic(list: string[], topicName: string) {
    return list.includes(topicName) ? list.filter((topic) => topic !== topicName) : [...list, topicName];
  }

  async function generatePreview() {
    setIsGenerating(true);
    setError(null);
    setSavedDraft(null);
    setPdfOutput(null);
    try {
      const payload =
        mode === "manual"
          ? {
              mode,
              question_ids: preview?.questions.map((question) => question.id) ?? manualQuestionIds,
            }
          : mode === "full_paper"
          ? {
              mode,
              paper_number: Number(paper),
              target_marks: Number(targetMarks),
              tolerance: Number(tolerance),
            }
          : mode === "question_numbers"
            ? {
                mode,
                paper_number: Number(paper),
                question_numbers: questionNumbers,
              }
            : {
                mode,
                paper_number: Number(paper),
                topic_rows: topicRows.map((row) => ({
                  required_topics: row.requiredTopics,
                  allowed_topics: row.allowedTopics,
                  count: row.count,
                })),
              };

      const response = await fetch(`${API_BASE}/api/exams/generate/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPreview(await readJson<GeneratedExamPreview>(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate exam preview.");
    } finally {
      setIsGenerating(false);
    }
  }

  function generationSettingsSnapshot() {
    return {
      paper_number: mode === "manual" ? null : Number(paper),
      mode,
      manual_question_ids: mode === "manual" ? preview?.questions.map((question) => question.id) ?? [] : [],
      target_marks: Number(targetMarks),
      tolerance: Number(tolerance),
      question_numbers: questionNumbers,
      topic_rows: topicRows.map((row) => ({
        required_topics: row.requiredTopics,
        allowed_topics: row.allowedTopics,
        count: row.count,
      })),
      question_order: preview?.questions.map((question) => question.id) ?? [],
      pdf_mask_settings: examMaskSettings,
      include_markscheme: includeMarkScheme,
    };
  }

  function updateExamMaskSetting(key: keyof PdfMaskSettings, value: boolean | number) {
    setExamMaskSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function setPreviewQuestions(nextQuestions: GeneratedQuestion[]) {
    setPreview((current) =>
      current
        ? {
            ...current,
            count: nextQuestions.length,
            total_marks: nextQuestions.reduce((total, question) => total + (question.marks ?? 0), 0),
            questions: nextQuestions,
          }
        : current,
    );
    setSavedDraft(null);
    setPdfOutput(null);
  }

  function removePreviewQuestion(questionId: number) {
    setPreviewQuestions(previewQuestions.filter((question) => question.id !== questionId));
  }

  function toggleDraftSelection(draftId: number) {
    setSelectedDraftIds((current) => (current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]));
  }

  function toggleVisibleDraftSelection() {
    const visibleIds = visibleDrafts.map((draft) => draft.id);
    setSelectedDraftIds((current) => {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      return allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function deleteSelectedDrafts() {
    if (!selectedDraftIds.length) return;
    const confirmed = window.confirm(
      `Delete ${selectedDraftIds.length} selected draft${selectedDraftIds.length === 1 ? "" : "s"} from TeacherDesk? Generated PDF files on disk will not be deleted.`,
    );
    if (!confirmed) return;
    setIsDeletingDrafts(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/exams/drafts/delete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_ids: selectedDraftIds }),
      });
      await readJson<{ ok: boolean; deleted: number }>(response);
      if (savedDraft && selectedDraftIds.includes(savedDraft.id)) {
        setSavedDraft(null);
      }
      setSelectedDraftIds([]);
      await loadSavedDrafts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete selected drafts.");
    } finally {
      setIsDeletingDrafts(false);
    }
  }

  function movePreviewQuestion(questionId: number, direction: -1 | 1) {
    const index = previewQuestions.findIndex((question) => question.id === questionId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= previewQuestions.length) return;
    const nextQuestions = [...previewQuestions];
    [nextQuestions[index], nextQuestions[targetIndex]] = [nextQuestions[targetIndex], nextQuestions[index]];
    setPreviewQuestions(nextQuestions);
  }

  async function saveDraft(): Promise<SavedExamDraft | null> {
    if (!preview?.questions.length) return null;
    setIsSavingDraft(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/exams/drafts/save/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle,
          mode,
          question_ids: preview.questions.map((question) => question.id),
          settings_snapshot: generationSettingsSnapshot(),
        }),
      });
      const result = await readJson<{ ok: boolean; exam: SavedExamDraft }>(response);
      setSavedDraft(result.exam);
      await loadSavedDrafts();
      return result.exam;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save draft exam.");
      return null;
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function browseExamOutputFolder() {
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/splitter/browse/folder/?initial_dir=${encodeURIComponent(outputFolder)}&title=${encodeURIComponent("Select generated exam output folder")}`,
      );
      const result = await readJson<{ selected_path: string; cancelled: boolean }>(response);
      if (!result.cancelled) {
        setOutputFolder(result.selected_path);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open folder dialog.");
    }
  }

  async function loadDraft(draftId: number) {
    setError(null);
    setPdfOutput(null);
    try {
      const draft = await readJson<SavedExamDraft>(
        await fetch(`${API_BASE}/api/exams/drafts/${draftId}/`),
      );
      setSavedDraft(draft);
      setDraftTitle(draft.title);
      setPreview({
        count: draft.question_count,
        total_marks: draft.total_marks,
        target_marks: null,
        warnings: [],
        questions: draft.questions ?? [],
      });
      const snapshotMasks = draft.settings_snapshot?.pdf_mask_settings;
      const snapshot = draft.settings_snapshot ?? {};
      if (snapshot.mode && typeof snapshot.mode === "string") setMode(snapshot.mode as ExamMode);
      if (snapshot.paper_number) setPaper(String(snapshot.paper_number));
      if (snapshot.target_marks) setTargetMarks(String(snapshot.target_marks));
      if (snapshot.tolerance) setTolerance(String(snapshot.tolerance));
      if (snapshot.question_numbers && typeof snapshot.question_numbers === "string") setQuestionNumbers(snapshot.question_numbers);
      if (Array.isArray(snapshot.topic_rows)) {
        setTopicRows(
          snapshot.topic_rows.map((row, index) => ({
            id: Date.now() + index,
            requiredTopics: Array.isArray(row.required_topics) ? row.required_topics : [],
            allowedTopics: Array.isArray(row.allowed_topics) ? row.allowed_topics : [],
            count: Number(row.count || 1),
          })),
        );
      }
      if (typeof snapshot.include_markscheme === "boolean") setIncludeMarkScheme(snapshot.include_markscheme);
      if (snapshotMasks && typeof snapshotMasks === "object") {
        setExamMaskSettings(snapshotMasks as PdfMaskSettings);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load draft.");
    }
  }

  async function generateDraftPdfs(draftId: number) {
    setIsGeneratingPdfs(true);
    setError(null);
    setPdfOutput(null);
    try {
      const response = await fetch(`${API_BASE}/api/exams/drafts/${draftId}/generate-pdfs/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_root: outputFolder, pdf_mask_settings: examMaskSettings, include_markscheme: includeMarkScheme }),
      });
      const result = await readJson<{ ok: boolean; outputs: { exam_pdf_path: string; markscheme_pdf_path: string; output_folder?: string }; exam: SavedExamDraft }>(response);
      setPdfOutput(result.outputs);
      setSavedDraft(result.exam);
      await loadSavedDrafts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate PDFs.");
    } finally {
      setIsGeneratingPdfs(false);
    }
  }

  async function generateCurrentPdfs() {
    let draft = savedDraft;
    if (!draft) {
      draft = await saveDraft();
    }
    if (draft) {
      await generateDraftPdfs(draft.id);
    }
  }

  async function openGeneratedOutput(target: "qp" | "ms" | "folder") {
    if (!savedDraft) return;
    const response = await fetch(`${API_BASE}/api/exams/drafts/${savedDraft.id}/open-output/?target=${target}`);
    const result = await readJson<{ ok: boolean; error?: string }>(response);
    if (!result.ok) {
      setError(result.error ?? "Could not open generated output.");
    }
  }

  return (
    <>
      <section className="content-header exam-header">
        <div>
          <p className="eyebrow">Exam Generator</p>
          <h1>Create an exam</h1>
          <span>Create, edit, and generate exams from your local question bank.</span>
        </div>
      </section>

      {error ? <div className="exam-page-error callout error">{error}</div> : null}

      <section className="exam-workspace">
        <div className="exam-main-panel">
          <div className="exam-setup-card">
            <div className="panel-title compact-title">
              <div>
                <strong>Create or edit exam</strong>
                <span>Choose the source, preview the paper, then export PDFs.</span>
              </div>
            </div>

            <div className="exam-setup-grid">
              <label className="field-block">
                <span>Title</span>
                <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
              </label>
              <label className="field-block">
                <span>Paper</span>
                <select value={paper} onChange={(event) => setPaper(event.target.value)} disabled={mode === "manual"}>
                  {(paperOptions.length ? paperOptions : [1, 2, 3, 4, 5]).map((paperNumber) => (
                    <option key={paperNumber} value={paperNumber}>
                      Paper {paperNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-block output-field">
                <span>Output folder</span>
                <div className="path-control">
                  <input value={outputFolder} onChange={(event) => setOutputFolder(event.target.value)} />
                  <button className="secondary-action" type="button" onClick={browseExamOutputFolder}>Browse</button>
                </div>
              </label>
              <label className="switch-row include-ms-row">
                <input type="checkbox" checked={includeMarkScheme} onChange={(event) => setIncludeMarkScheme(event.target.checked)} />
                <span>Include mark scheme PDF</span>
              </label>
            </div>

            <div className="mode-tabs exam-mode-tabs">
              <button className={mode === "full_paper" ? "selected" : ""} onClick={() => setMode("full_paper")}>Full paper</button>
              <button className={mode === "question_numbers" ? "selected" : ""} onClick={() => setMode("question_numbers")}>Question numbers</button>
              <button className={mode === "topics" ? "selected" : ""} onClick={() => setMode("topics")}>By topic</button>
              <button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>From Question Bank</button>
            </div>

            <div className="exam-mode-body">
              {mode === "full_paper" ? (
                <div className="exam-rule-grid">
                  <label className="field-block">
                    <span>Target marks</span>
                    <input type="number" min="1" value={targetMarks} onChange={(event) => setTargetMarks(event.target.value)} />
                  </label>
                  <label className="field-block">
                    <span>Allowed over target</span>
                    <input type="number" min="0" value={tolerance} onChange={(event) => setTolerance(event.target.value)} />
                  </label>
                  <div className="exam-rule-note">
                    <strong>Full paper selection</strong>
                    <span>TeacherDesk chooses one question per question number, keeps marks close to target, and spreads topics across chapters where possible.</span>
                  </div>
                </div>
              ) : null}

              {mode === "question_numbers" ? (
                <div className="exam-question-number-mode">
                  <label className="field-block">
                    <span>Question numbers</span>
                    <input value={questionNumbers} onChange={(event) => setQuestionNumbers(event.target.value)} placeholder="2, 4-6" />
                  </label>
                  <div className="availability-chip-row">
                    {availability.question_counts && Object.entries(availability.question_counts).length
                      ? Object.entries(availability.question_counts).map(([questionNumber, count]) => (
                          <span className={count ? "availability-chip" : "availability-chip warning"} key={questionNumber}>
                            Q{questionNumber}: {count}
                          </span>
                        ))
                      : <span className="availability-chip muted">Enter numbers to see availability</span>}
                  </div>
                </div>
              ) : null}

              {mode === "topics" ? (
                <div className="exam-topic-builder">
                  {topicRows.map((row, index) => (
                    <div className="exam-topic-row" key={row.id}>
                      <div className="topic-row-head">
                        <strong>Topic rule {index + 1}</strong>
                        <span>{availability.topic_row_counts?.[index] ?? 0} available</span>
                        <button className="ghost-button" onClick={() => removeTopicRow(row.id)} disabled={topicRows.length === 1}>Remove</button>
                      </div>
                      <label className="field-block topic-count-field">
                        <span>Questions</span>
                        <input
                          type="number"
                          min="1"
                          max={availability.topic_row_counts?.[index] ?? undefined}
                          value={row.count}
                          onChange={(event) => {
                            const available = availability.topic_row_counts?.[index];
                            const requested = Number(event.target.value);
                            updateTopicRow(row.id, { count: available ? Math.min(requested, available) : requested });
                          }}
                        />
                      </label>
                      <TopicCheckboxList
                        title="Required topics"
                        description="Question must include all selected."
                        topics={topicNames}
                        selected={row.requiredTopics}
                        onToggle={(topicName) => updateTopicRow(row.id, { requiredTopics: toggleTopic(row.requiredTopics, topicName) })}
                      />
                      <TopicCheckboxList
                        title="Allowed topics"
                        description="Question may also include these."
                        topics={topicNames}
                        selected={row.allowedTopics}
                        onToggle={(topicName) => updateTopicRow(row.id, { allowedTopics: toggleTopic(row.allowedTopics, topicName) })}
                        actions={
                          <>
                            <button className="ghost-button" onClick={() => updateTopicRow(row.id, { allowedTopics: topicNames })}>All</button>
                            <button className="ghost-button" onClick={() => updateTopicRow(row.id, { allowedTopics: [] })}>None</button>
                          </>
                        }
                      />
                    </div>
                  ))}
                  <button className="secondary-action add-topic-row" onClick={addTopicRow}>
                    <Plus size={16} />
                    Add topic row
                  </button>
                </div>
              ) : null}

              {mode === "manual" ? (
                <div className="manual-mode-card">
                  <div>
                    <strong>{previewQuestions.length ? `${previewQuestions.length} selected question${previewQuestions.length === 1 ? "" : "s"}` : "No selected questions yet"}</strong>
                    <span>Add questions from Question Bank, then arrange or remove them here before saving.</span>
                  </div>
                  <button className="secondary-action" onClick={onOpenQuestionBank}>
                    <Plus size={16} />
                    Add more questions
                  </button>
                </div>
              ) : null}
            </div>

            <div className="selected-question-panel">
              <div className="panel-title compact-title">
                <div>
                  <strong>Selected questions ({previewQuestions.length})</strong>
                  <span>Drag-style ordering controls are available before export.</span>
                </div>
                <button className="secondary-action" onClick={generatePreview} disabled={isGenerating || !paper}>
                  <Shuffle size={16} />
                  {isGenerating ? "Generating..." : "Generate preview"}
                </button>
              </div>

              <div className="exam-question-table-wrap">
                <table className="exam-question-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Exam code</th>
                      <th>Paper</th>
                      <th>Question</th>
                      <th>Marks</th>
                      <th>Topics</th>
                      <th>Review status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewQuestions.length ? (
                      previewQuestions.map((question, index) => {
                        const visibleTopics = question.topics.slice(0, 2);
                        return (
                        <tr key={question.id}>
                          <td>
                            <div className="order-controls">
                              <button onClick={() => movePreviewQuestion(question.id, -1)} disabled={index === 0} title="Move up"><ArrowUp size={14} /></button>
                              <span>{index + 1}</span>
                              <button onClick={() => movePreviewQuestion(question.id, 1)} disabled={index === previewQuestions.length - 1} title="Move down"><ArrowDown size={14} /></button>
                            </div>
                          </td>
                          <td className="mono">{question.exam}</td>
                          <td>{question.paper}</td>
                          <td>{question.question}</td>
                          <td>{question.marks ?? "-"}</td>
                          <td>
                            <div className="topic-list" title={question.topics.length ? question.topics.join(", ") : "No topics"}>
                              {visibleTopics.length ? visibleTopics.map((topic) => <span key={topic} title={topic}>{topic}</span>) : <em>No topics</em>}
                              {question.topics.length > visibleTopics.length ? <em title={question.topics.slice(visibleTopics.length).join(", ")}>+{question.topics.length - visibleTopics.length}</em> : null}
                            </div>
                          </td>
                          <td>
                            {question.qp_status === "Needs review" || question.ms_status === "Needs review" ? (
                              <span className="mini-status warn">Needs review</span>
                            ) : (
                              <span className="mini-status ok">Not required</span>
                            )}
                          </td>
                          <td>
                            <button className="danger-link" onClick={() => removePreviewQuestion(question.id)}>Remove</button>
                          </td>
                        </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8}>
                          <div className="empty-state compact">
                            <Shuffle size={24} />
                            <strong>No preview yet</strong>
                            <span>Choose a mode and generate a preview.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="exam-bottom-grid">
            <div className="exam-summary-card">
              <strong>Preview summary</strong>
              <div>
                <span><b>{previewQuestions.length}</b>Total questions</span>
                <span><b>{preview?.total_marks ?? 0}</b>Total marks</span>
                <span><b>{totalPagesEstimate}</b>Total pages est.</span>
              </div>
            </div>
            <div className="exam-summary-card warning-summary">
              <strong>Warnings & notes ({preview?.warnings.length ?? 0})</strong>
              {preview?.warnings.length ? (
                preview.warnings.slice(0, 3).map((warning) => <span key={warning}>{warning}</span>)
              ) : (
                <span>No warnings for the current preview.</span>
              )}
            </div>
            <div className="exam-summary-card">
              <strong>Review status breakdown</strong>
              <div>
                <span><b>{reviewBreakdown.notRequired}</b>Not required</span>
                <span><b>{reviewBreakdown.needsReview}</b>Needs review</span>
                <span><b>{reviewBreakdown.missing}</b>Missing marks</span>
              </div>
            </div>
          </div>
        </div>

        <aside className="exam-side-panel">
          <section className="drafts-card">
            <div className="panel-title compact-title">
              <div>
                <strong>Drafts</strong>
                <span>Search drafts by title, paper, or topic.</span>
              </div>
              <div className="draft-panel-actions">
                <button className="ghost-button danger-action" disabled={!selectedDraftIds.length || isDeletingDrafts} onClick={deleteSelectedDrafts}>
                  {isDeletingDrafts ? "Deleting..." : selectedDraftIds.length ? `Delete ${selectedDraftIds.length}` : "Delete"}
                </button>
                <button className="icon-button" onClick={loadSavedDrafts} title="Refresh drafts">
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>
            <div className="draft-filter-row">
              <label className="table-search">
                <Search size={15} />
                <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search drafts" />
              </label>
              <select value={draftStatusFilter} onChange={(event) => setDraftStatusFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="ready">PDF ready</option>
              </select>
            </div>
            <div className="draft-table">
              <div className="draft-table-head">
                <span>
                  <input
                    type="checkbox"
                    aria-label="Select visible drafts"
                    checked={visibleDrafts.length > 0 && visibleDrafts.every((draft) => selectedDraftIds.includes(draft.id))}
                    onChange={toggleVisibleDraftSelection}
                  />
                </span>
                <span>Title</span>
                <span>Paper</span>
                <span>Qs</span>
                <span>Marks</span>
                <span>Status</span>
              </div>
              {visibleDrafts.length ? (
                visibleDrafts.map((draft) => (
                  <button className={savedDraft?.id === draft.id ? "draft-row active" : "draft-row"} key={draft.id} onClick={() => loadDraft(draft.id)} title={draft.title}>
                    <span className="draft-select-cell" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select draft ${draft.title}`}
                        checked={selectedDraftIds.includes(draft.id)}
                        onChange={() => toggleDraftSelection(draft.id)}
                      />
                    </span>
                    <strong title={draft.title}>{draft.title}</strong>
                    <span>{draft.settings_snapshot?.paper_number ? `Paper ${draft.settings_snapshot.paper_number}` : "-"}</span>
                    <span>{draft.question_count}</span>
                    <span>{draft.total_marks}</span>
                    <em className={draft.exam_pdf_path ? "ready" : "draft"}>{draft.exam_pdf_path ? "PDF ready" : "Draft"}</em>
                  </button>
                ))
              ) : (
                <div className="empty-state compact">
                  <Database size={22} />
                  <strong>No drafts found</strong>
                  <span>Save a preview to keep it here.</span>
                </div>
              )}
            </div>
          </section>

          <section className="pdf-output-card">
            <div className="panel-title compact-title">
              <div>
                <strong>PDF output</strong>
                <span>{savedDraft ? `Current draft: ${savedDraft.title}` : "Save or generate from the current preview."}</span>
              </div>
            </div>
            <button className="primary-action full-width" onClick={generatePreview} disabled={isGenerating || !paper}>
              <Shuffle size={16} />
              {isGenerating ? "Generating..." : "Generate preview"}
            </button>
            <button className="secondary-action full-width" disabled={!previewQuestions.length || isSavingDraft} onClick={() => void saveDraft()}>
              <FileText size={16} />
              {isSavingDraft ? "Saving..." : "Save draft"}
            </button>
            <button className="primary-action full-width" disabled={!previewQuestions.length || isGeneratingPdfs} onClick={generateCurrentPdfs}>
              <FileText size={16} />
              {isGeneratingPdfs ? "Generating..." : "Generate PDFs"}
            </button>
            <div className="output-actions stacked">
              <button className="secondary-action output-open-action" disabled={!savedDraft?.exam_pdf_path} onClick={() => openGeneratedOutput("qp")}>Open question paper</button>
              <button className="secondary-action output-open-action" disabled={!includeMarkScheme || !savedDraft?.markscheme_pdf_path} onClick={() => openGeneratedOutput("ms")}>Open mark scheme</button>
              <button className="secondary-action output-open-action" disabled={!savedDraft?.exam_pdf_path && !savedDraft?.markscheme_pdf_path} onClick={() => openGeneratedOutput("folder")}>Open output folder</button>
            </div>
            {pdfOutput ? <div className="callout success compact-callout">PDFs generated in {pdfOutput.output_folder ?? outputFolder}</div> : null}
            <details className="exam-mask-details">
              <summary>Header and footer masks</summary>
              <div className="mask-settings-grid compact">
                <MaskSettingRow label="QP header" enabled={examMaskSettings.qp_header_enabled} value={examMaskSettings.qp_header_mm} onEnabled={(value) => updateExamMaskSetting("qp_header_enabled", value)} onValue={(value) => updateExamMaskSetting("qp_header_mm", value)} />
                <MaskSettingRow label="QP footer" enabled={examMaskSettings.qp_footer_enabled} value={examMaskSettings.qp_footer_mm} onEnabled={(value) => updateExamMaskSetting("qp_footer_enabled", value)} onValue={(value) => updateExamMaskSetting("qp_footer_mm", value)} />
                <MaskSettingRow label="MS header" enabled={examMaskSettings.ms_header_enabled} value={examMaskSettings.ms_header_mm} onEnabled={(value) => updateExamMaskSetting("ms_header_enabled", value)} onValue={(value) => updateExamMaskSetting("ms_header_mm", value)} />
                <MaskSettingRow label="MS footer" enabled={examMaskSettings.ms_footer_enabled} value={examMaskSettings.ms_footer_mm} onEnabled={(value) => updateExamMaskSetting("ms_footer_enabled", value)} onValue={(value) => updateExamMaskSetting("ms_footer_mm", value)} />
              </div>
            </details>
          </section>
        </aside>
      </section>
    </>
  );
}

function TopicCheckboxList({
  title,
  description,
  topics,
  selected,
  onToggle,
  actions,
}: {
  title: string;
  description: string;
  topics: string[];
  selected: string[];
  onToggle: (topicName: string) => void;
  actions?: ReactNode;
}) {
  return (
    <div className="topic-multi-select">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
        {actions ? <div>{actions}</div> : null}
      </div>
      <div className="topic-checkbox-grid">
        {topics.map((topicName) => (
          <label key={topicName}>
            <input type="checkbox" checked={selected.includes(topicName)} onChange={() => onToggle(topicName)} />
            <span>{topicName}</span>
          </label>
        ))}
      </div>
    </div>
  );
}



