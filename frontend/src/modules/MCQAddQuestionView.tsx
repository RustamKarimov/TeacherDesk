import { Check, Image, Plus, Save, Sigma, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQAsset, MCQAssetListPayload, MCQMetadataPayload, MCQReviewStatus } from "../types";

type EditorStep = "layout" | "question" | "options" | "metadata" | "preview";
type OptionDraft = { label: string; text: string; assetId: number | null };
type LastMetadataDefaults = {
  subject: string;
  syllabus: string;
  examCode: string;
  paperCode: string;
  session: string;
  year: string;
  source: string;
  difficulty: string;
  reviewStatus: MCQReviewStatus;
  topicIds: number[];
  subtopicIds: number[];
  tagIds: number[];
};
type MCQQuestionDetailPayload = {
  id: number;
  title: string;
  subject: string;
  syllabus: string;
  exam_code: string;
  paper_code: string;
  session: string;
  year: number | null;
  source: string;
  source_question_number: string;
  marks: number;
  difficulty: string;
  review_status: MCQReviewStatus;
  layout_preset: string;
  option_layout: string;
  topics: Array<{ id: number; name: string }>;
  subtopics: Array<{ id: number; name: string; topic_id: number }>;
  tags: Array<{ id: number; name: string }>;
  notes: string;
  teacher_notes: string;
  blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; order: number }>;
  options: Array<{
    label: string;
    is_correct: boolean;
    order: number;
    blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; order: number }>;
  }>;
};

const stepLabels: Array<{ value: EditorStep; label: string }> = [
  { value: "layout", label: "Layout" },
  { value: "question", label: "Question" },
  { value: "options", label: "Options" },
  { value: "metadata", label: "Metadata" },
  { value: "preview", label: "Preview" },
];

const metadataDefaultsKey = "teacherdesk.mcq.lastMetadata";

const layoutVisuals = [
  { value: "standard", title: "Standard", note: "Text and options below", className: "standard" },
  { value: "image_above", title: "Image above", note: "Diagram before options", className: "image-above" },
  { value: "text_image_side", title: "Side image", note: "Text beside diagram", className: "side-image" },
  { value: "image_only", title: "Image only", note: "Diagram-led question", className: "image-only" },
  { value: "option_grid", title: "Image options", note: "Choices in a grid", className: "option-grid" },
  { value: "table_options", title: "Table options", note: "For structured choices", className: "table-options" },
  { value: "compact", title: "Compact", note: "Tighter exam style", className: "compact" },
];

const optionLayoutVisuals = [
  { value: "single", title: "Single column", className: "single" },
  { value: "two_column", title: "Two columns", className: "two-column" },
  { value: "four_column", title: "Four columns", className: "four-column" },
  { value: "grid", title: "Image grid", className: "grid" },
  { value: "table", title: "Table", className: "table" },
];

const defaultOptions: OptionDraft[] = [
  { label: "A", text: "", assetId: null },
  { label: "B", text: "", assetId: null },
  { label: "C", text: "", assetId: null },
  { label: "D", text: "", assetId: null },
];

export function MCQAddQuestionView({ questionId, onSaved }: { questionId?: number | null; onSaved: () => void }) {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [step, setStep] = useState<EditorStep>("layout");
  const [title, setTitle] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [assets, setAssets] = useState<MCQAsset[]>([]);
  const [questionAssetId, setQuestionAssetId] = useState<number | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [correctOption, setCorrectOption] = useState("A");
  const [marks, setMarks] = useState(1);
  const [options, setOptions] = useState<OptionDraft[]>(defaultOptions);
  const [layoutPreset, setLayoutPreset] = useState("standard");
  const [optionLayout, setOptionLayout] = useState("single");
  const [subject, setSubject] = useState("Physics");
  const [syllabus, setSyllabus] = useState("9702");
  const [examCode, setExamCode] = useState("");
  const [paperCode, setPaperCode] = useState("");
  const [session, setSession] = useState("");
  const [year, setYear] = useState("");
  const [source, setSource] = useState("");
  const [sourceQuestionNumber, setSourceQuestionNumber] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [reviewStatus, setReviewStatus] = useState<MCQReviewStatus>("draft");
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [subtopicIds, setSubtopicIds] = useState<number[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [teacherNotes, setTeacherNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const visibleSubtopics = useMemo(() => {
    const selectedTopics = metadata?.topics.filter((topic) => topicIds.includes(topic.id)) ?? [];
    return selectedTopics.flatMap((topic) => topic.subtopics.map((subtopic) => ({ ...subtopic, topicName: topic.name })));
  }, [metadata, topicIds]);

  const selectedQuestionAsset = useMemo(
    () => assets.find((asset) => asset.id === questionAssetId) ?? null,
    [assets, questionAssetId],
  );

  const questionParagraphs = useMemo(() => questionText.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean), [questionText]);

  useEffect(() => {
    fetch(`${API_BASE}/api/mcq/metadata/`)
      .then((response) => readJson<MCQMetadataPayload>(response))
      .then(setMetadata)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ metadata."));
    fetch(`${API_BASE}/api/mcq/assets/`)
      .then((response) => readJson<MCQAssetListPayload>(response))
      .then((payload) => setAssets(payload.results))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ image assets."));
  }, []);

  useEffect(() => {
    if (!questionId) {
      resetForm();
      return;
    }
    fetch(`${API_BASE}/api/mcq/questions/${questionId}/`)
      .then((response) => readJson<MCQQuestionDetailPayload>(response))
      .then(loadQuestionIntoForm)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ question."));
  }, [questionId]);

  function loadQuestionIntoForm(question: MCQQuestionDetailPayload) {
    setTitle(question.title ?? "");
    setQuestionText(
      question.blocks
        .filter((block) => block.block_type === "text")
        .sort((left, right) => left.order - right.order)
        .map((block) => block.text)
        .join("\n\n"),
    );
    const imageBlock = question.blocks.find((block) => block.block_type === "image" && block.asset_id);
    setQuestionAssetId(imageBlock?.asset_id ?? null);
    const imageAsset = imageBlock?.asset;
    if (imageAsset) {
      setAssets((current) => (current.some((asset) => asset.id === imageAsset.id) ? current : [imageAsset, ...current]));
    }
    setCorrectOption(question.options.find((option) => option.is_correct)?.label ?? "A");
    setMarks(question.marks ?? 1);
    setOptions(
      question.options.length
        ? question.options
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((option) => {
              const imageBlock = option.blocks.find((block) => block.block_type === "image" && block.asset_id);
              if (imageBlock?.asset) {
                setAssets((current) => (current.some((asset) => asset.id === imageBlock.asset?.id) ? current : [imageBlock.asset!, ...current]));
              }
              return {
                label: option.label,
                text: option.blocks.find((block) => block.block_type === "text")?.text ?? "",
                assetId: imageBlock?.asset_id ?? null,
              };
            })
        : defaultOptions,
    );
    setLayoutPreset(question.layout_preset || "standard");
    setOptionLayout(question.option_layout || "single");
    setSubject(question.subject || "Physics");
    setSyllabus(question.syllabus || "9702");
    setExamCode(question.exam_code || "");
    setPaperCode(question.paper_code || "");
    setSession(question.session || "");
    setYear(question.year ? String(question.year) : "");
    setSource(question.source || "");
    setSourceQuestionNumber(question.source_question_number || "");
    setDifficulty(question.difficulty || "");
    setReviewStatus(question.review_status || "draft");
    setTopicIds(question.topics.map((topic) => topic.id));
    setSubtopicIds(question.subtopics.map((subtopic) => subtopic.id));
    setTagIds(question.tags.map((tag) => tag.id));
    setNotes(question.notes || "");
    setTeacherNotes(question.teacher_notes || "");
    setStep("layout");
  }

  function readLastMetadataDefaults(): LastMetadataDefaults | null {
    try {
      const raw = localStorage.getItem(metadataDefaultsKey);
      return raw ? JSON.parse(raw) as LastMetadataDefaults : null;
    } catch {
      return null;
    }
  }

  function applyMetadataDefaults() {
    const defaults = readLastMetadataDefaults();
    if (!defaults) return;
    setSubject(defaults.subject || "Physics");
    setSyllabus(defaults.syllabus || "9702");
    setExamCode(defaults.examCode || "");
    setPaperCode(defaults.paperCode || "");
    setSession(defaults.session || "");
    setYear(defaults.year || "");
    setSource(defaults.source || "");
    setDifficulty(defaults.difficulty || "");
    setReviewStatus(defaults.reviewStatus || "draft");
    setTopicIds(defaults.topicIds || []);
    setSubtopicIds(defaults.subtopicIds || []);
    setTagIds(defaults.tagIds || []);
  }

  function rememberMetadataDefaults() {
    const defaults: LastMetadataDefaults = {
      subject,
      syllabus,
      examCode,
      paperCode,
      session,
      year,
      source,
      difficulty,
      reviewStatus,
      topicIds,
      subtopicIds,
      tagIds,
    };
    localStorage.setItem(metadataDefaultsKey, JSON.stringify(defaults));
  }

  function buildAutomaticTitle() {
    const sourceLabel = [examCode, sourceQuestionNumber].filter(Boolean).join(" ");
    if (sourceLabel) return sourceLabel;
    const firstText = questionText.replace(/\s+/g, " ").trim();
    if (firstText) return firstText.slice(0, 90);
    return selectedQuestionAsset?.original_name || "Image-only MCQ question";
  }

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? { ...option, ...patch } : option)));
  }

  function addOption() {
    const nextLabel = String.fromCharCode(65 + options.length);
    setOptions((current) => [...current, { label: nextLabel, text: "", assetId: null }]);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    const removedLabel = options[index].label;
    const nextOptions = options.filter((_, optionIndex) => optionIndex !== index);
    setOptions(nextOptions);
    if (correctOption === removedLabel) {
      setCorrectOption(nextOptions[0]?.label ?? "A");
    }
  }

  function toggleNumberValue(value: number, selected: number[], setter: (values: number[]) => void) {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  async function saveQuestion(stayOnPage = false) {
    setStatus(null);
    setError(null);
    if (!questionText.trim() && !questionAssetId) {
      setError("Add question text or attach a question image before saving.");
      setStep("question");
      return;
    }
    if (!options.some((option) => option.label === correctOption)) {
      setError("Choose a valid correct option.");
      setStep("options");
      return;
    }
    if (!sourceQuestionNumber.trim() && !confirm("Original question number is empty. This is useful when entering many questions from the same paper. Save anyway?")) {
      setStep("metadata");
      return;
    }
    setIsSaving(true);
    try {
      const autoTitle = title.trim() || buildAutomaticTitle();
      const url = questionId ? `${API_BASE}/api/mcq/questions/${questionId}/update/` : `${API_BASE}/api/mcq/questions/create/`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: autoTitle,
          question_text: questionText,
          question_asset_id: questionAssetId,
          correct_option: correctOption,
          marks,
          option_labels: options.map((option) => option.label),
          option_texts: Object.fromEntries(options.map((option) => [option.label, option.text])),
          option_asset_ids: Object.fromEntries(options.filter((option) => option.assetId).map((option) => [option.label, option.assetId])),
          layout_preset: layoutPreset,
          option_layout: optionLayout,
          subject,
          syllabus,
          exam_code: examCode,
          paper_code: paperCode,
          session,
          year,
          source,
          source_question_number: sourceQuestionNumber,
          difficulty,
          review_status: reviewStatus,
          topic_ids: topicIds,
          subtopic_ids: subtopicIds,
          tag_ids: tagIds,
          notes,
          teacher_notes: teacherNotes,
        }),
      });
      await readJson(response);
      rememberMetadataDefaults();
      setStatus(questionId ? "Question updated." : "Question saved.");
      if (stayOnPage) {
        resetForm();
      } else {
        onSaved();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save question.");
    } finally {
      setIsSaving(false);
    }
  }

  function resetForm() {
    setTitle("");
    setQuestionText("");
    setQuestionAssetId(null);
    setCorrectOption("A");
    setMarks(1);
    setOptions(defaultOptions);
    setStep("layout");
    setSourceQuestionNumber("");
    setNotes("");
    setTeacherNotes("");
    if (!questionId) {
      applyMetadataDefaults();
    }
  }

  async function uploadQuestionAsset(file: File | null) {
    if (!file) return;
    setError(null);
    setStatus(null);
    setIsUploadingAsset(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("asset_type", "question");
      const response = await fetch(`${API_BASE}/api/mcq/assets/upload/`, {
        method: "POST",
        body: formData,
      });
      const asset = await readJson<MCQAsset>(response);
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setQuestionAssetId(asset.id);
      setStatus("Question image uploaded and attached.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload question image.");
    } finally {
      setIsUploadingAsset(false);
    }
  }

  async function uploadOptionAsset(index: number, file: File | null) {
    if (!file) return;
    setError(null);
    setStatus(null);
    setIsUploadingAsset(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("asset_type", "option");
      const response = await fetch(`${API_BASE}/api/mcq/assets/upload/`, {
        method: "POST",
        body: formData,
      });
      const asset = await readJson<MCQAsset>(response);
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      updateOption(index, { assetId: asset.id });
      setStatus(`Image attached to option ${options[index]?.label ?? ""}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload option image.");
    } finally {
      setIsUploadingAsset(false);
    }
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>{questionId ? "Edit MCQ Question" : "Add MCQ Question"}</h1>
          <span className="header-subtitle">Build one printable A4-width multiple-choice question.</span>
        </div>
        <button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(false)}><Save size={17} />Save question</button>
      </section>

      <section className="mcq-editor-grid">
        <div className="panel mcq-editor-panel">
          <div className="step-tabs">
            {stepLabels.map((item) => <button className={step === item.value ? "active" : ""} key={item.value} onClick={() => setStep(item.value)}>{item.label}</button>)}
          </div>
          {status ? <div className="callout success">{status}</div> : null}
          {error ? <div className="callout error">{error}</div> : null}

          {step === "layout" ? (
            <div className="mcq-step-panel">
              <div className="section-intro compact">
                <strong>Choose the question layout first</strong>
                <span>This controls how the question, image, and answer choices are arranged in the live preview and future exam export.</span>
              </div>
              <div className="layout-card-grid">
                {layoutVisuals.map((item) => (
                  <button className={`layout-choice-card ${layoutPreset === item.value ? "active" : ""}`} key={item.value} onClick={() => setLayoutPreset(item.value)} type="button">
                    <span className={`layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span>
                    <strong>{item.title}</strong>
                    <small>{item.note}</small>
                  </button>
                ))}
              </div>
              <div className="section-intro compact">
                <strong>Answer option layout</strong>
                <span>Select the visual arrangement for A-D choices.</span>
              </div>
              <div className="option-layout-card-grid">
                {optionLayoutVisuals.map((item) => (
                  <button className={`option-layout-card ${optionLayout === item.value ? "active" : ""}`} key={item.value} onClick={() => setOptionLayout(item.value)} type="button">
                    <span className={`option-layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span>
                    <strong>{item.title}</strong>
                  </button>
                ))}
              </div>
              <div className="option-entry-grid">
                <label className="field-stack"><span>Marks</span><input type="number" min={0} value={marks} onChange={(event) => setMarks(Number(event.target.value || 1))} /></label>
                <label className="field-stack"><span>Review status</span><select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as MCQReviewStatus)}>{metadata?.review_statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              </div>
            </div>
          ) : null}

          {step === "question" ? (
            <div className="mcq-step-panel">
              <div className="section-intro compact">
                <strong>Question content</strong>
                <span>Leave a blank line between paragraphs. TeacherDesk saves each paragraph as a separate text block.</span>
              </div>
              <label className="field-stack"><span>Question text</span><textarea value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Type text here. Use $v = u + at$ for inline equations or $$E = hf$$ for display equations. Leave a blank line for a new paragraph." /></label>
              <div className="asset-upload-card">
                <div>
                  <strong>Question image</strong>
                  <span>Use this for diagrams, graphs, circuits, or image-only questions.</span>
                </div>
                <div className="asset-controls">
                  <label className="compact-upload-button">
                    <UploadCloud size={16} />
                    {isUploadingAsset ? "Uploading..." : "Upload image"}
                    <input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadQuestionAsset(event.target.files?.[0] ?? null)} />
                  </label>
                  <select value={questionAssetId ?? ""} onChange={(event) => setQuestionAssetId(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">No image attached</option>
                    {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.original_name}</option>)}
                  </select>
                  {questionAssetId ? <button className="secondary-action" type="button" onClick={() => setQuestionAssetId(null)}>Remove image</button> : null}
                </div>
                {selectedQuestionAsset ? (
                  <div className="asset-preview-strip">
                    <img src={`${API_BASE}${selectedQuestionAsset.preview_url}`} alt={selectedQuestionAsset.original_name} />
                    <span>{selectedQuestionAsset.original_name}</span>
                  </div>
                ) : null}
              </div>
              <div className="builder-actions">
                <button className="secondary-action" type="button" onClick={() => setQuestionText((current) => `${current}${current ? " " : ""}$v = u + at$`)}><Sigma size={16} />Insert equation</button>
                <button className="secondary-action" type="button" onClick={() => setQuestionText((current) => `${current}${current ? "\n\n" : ""}`)}>New paragraph</button>
              </div>
            </div>
          ) : null}

          {step === "options" ? (
            <div className="mcq-step-panel">
              <div className="option-editor-list">
                {options.map((option, index) => (
                  <div className={`option-editor-card ${correctOption === option.label ? "correct" : ""}`} key={option.label}>
                    <div className="option-card-head">
                      <button className="option-letter" onClick={() => setCorrectOption(option.label)} title="Mark as correct">{option.label}</button>
                      <strong>{correctOption === option.label ? "Correct answer" : "Answer option"}</strong>
                      <button className="icon-button" disabled={options.length <= 2} onClick={() => removeOption(index)}><Trash2 size={15} /></button>
                    </div>
                    <textarea value={option.text} onChange={(event) => updateOption(index, { text: event.target.value })} placeholder={`Option ${option.label} text. Use LaTeX such as $\\frac{1}{2}mv^2$.`} />
                    <div className="option-asset-row">
                      <label className="compact-upload-button">
                        <UploadCloud size={15} />
                        Upload option image
                        <input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadOptionAsset(index, event.target.files?.[0] ?? null)} />
                      </label>
                      <select value={option.assetId ?? ""} onChange={(event) => updateOption(index, { assetId: event.target.value ? Number(event.target.value) : null })}>
                        <option value="">No option image</option>
                        {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.original_name}</option>)}
                      </select>
                      {option.assetId ? <button className="secondary-action" type="button" onClick={() => updateOption(index, { assetId: null })}>Remove image</button> : null}
                    </div>
                    {option.assetId ? (
                      <div className="option-image-preview">
                        <img src={`${API_BASE}${assets.find((asset) => asset.id === option.assetId)?.preview_url ?? ""}`} alt={`${option.label} option`} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="builder-actions">
                <button className="secondary-action" onClick={addOption}><Plus size={16} />Add option</button>
                <button className="secondary-action" onClick={() => setOptionLayout("two_column")}>Use two columns</button>
              </div>
            </div>
          ) : null}

          {step === "metadata" ? (
            <div className="mcq-step-panel">
              <div className="section-intro compact">
                <strong>Source metadata</strong>
                <span>These fields reuse the last saved question by default. Change only the values that are different for the next question.</span>
              </div>
              {!sourceQuestionNumber.trim() ? <div className="callout warning">Original question number is empty. You can still save, but TeacherDesk will ask for confirmation.</div> : null}
              <div className="option-entry-grid">
                <label className="field-stack"><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
                <label className="field-stack"><span>Syllabus</span><input value={syllabus} onChange={(event) => setSyllabus(event.target.value)} /></label>
                <label className="field-stack"><span>Exam code</span><input value={examCode} onChange={(event) => setExamCode(event.target.value)} placeholder="9702_w23_qp_11" /></label>
                <label className="field-stack"><span>Paper code</span><input value={paperCode} onChange={(event) => setPaperCode(event.target.value)} placeholder="Paper 1" /></label>
                <label className="field-stack"><span>Session</span><input value={session} onChange={(event) => setSession(event.target.value)} placeholder="Oct/Nov" /></label>
                <label className="field-stack"><span>Year</span><input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2023" /></label>
                <label className="field-stack"><span>Source</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Manual / Cambridge / worksheet" /></label>
                <label className="field-stack"><span>Original question</span><input value={sourceQuestionNumber} onChange={(event) => setSourceQuestionNumber(event.target.value)} placeholder="Q12" /></label>
                <label className="field-stack"><span>Difficulty</span><input value={difficulty} onChange={(event) => setDifficulty(event.target.value)} placeholder="Easy / Medium / Hard" /></label>
              </div>

              <div className="metadata-picker">
                <strong>Topics</strong>
                <div className="checkbox-chip-grid">{metadata?.topics.map((topic) => <label key={topic.id}><input type="checkbox" checked={topicIds.includes(topic.id)} onChange={() => toggleNumberValue(topic.id, topicIds, setTopicIds)} />{topic.name}</label>)}</div>
              </div>
              {visibleSubtopics.length ? (
                <div className="metadata-picker">
                  <strong>Subtopics</strong>
                  <div className="checkbox-chip-grid">{visibleSubtopics.map((subtopic) => <label key={subtopic.id}><input type="checkbox" checked={subtopicIds.includes(subtopic.id)} onChange={() => toggleNumberValue(subtopic.id, subtopicIds, setSubtopicIds)} />{subtopic.name}</label>)}</div>
                </div>
              ) : null}
              <div className="metadata-picker">
                <strong>Tags</strong>
                <div className="checkbox-chip-grid">{metadata?.tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggleNumberValue(tag.id, tagIds, setTagIds)} />{tag.name}</label>)}</div>
              </div>
              <label className="field-stack"><span>Teacher notes</span><textarea value={teacherNotes} onChange={(event) => setTeacherNotes(event.target.value)} placeholder="Private notes for review, source details, or teaching remarks." /></label>
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="mcq-step-panel">
              <div className="save-summary">
                <div><strong>{title || "Untitled MCQ question"}</strong><span>{marks} mark / {options.length} options / {reviewStatus.replace("_", " ")}</span></div>
                <div><strong>Layout</strong><span>{layoutPreset} / {optionLayout}</span></div>
                <div><strong>Metadata</strong><span>{topicIds.length} topics / {tagIds.length} tags</span></div>
              </div>
              <label className="field-stack"><span>General notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes stored with this question." /></label>
            </div>
          ) : null}

          <div className="mcq-bottom-controls">
            <button className="secondary-action" disabled={step === "layout"} onClick={() => setStep(stepLabels[Math.max(stepLabels.findIndex((item) => item.value === step) - 1, 0)].value)}>Back</button>
            <button className="secondary-action" disabled={step === "preview"} onClick={() => setStep(stepLabels[Math.min(stepLabels.findIndex((item) => item.value === step) + 1, stepLabels.length - 1)].value)}>Continue</button>
            <button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(true)}><Plus size={16} />Save and add another</button>
          </div>
        </div>

        <aside className="panel mcq-preview-panel">
          <div className="dashboard-widget-head"><div><strong>A4-width live preview</strong><span>Exam font size is controlled during generation.</span></div></div>
          <div className="a4-preview-card">
            <div className="paper-question-number">1</div>
            <strong>{buildAutomaticTitle()}</strong>
            {questionParagraphs.length ? questionParagraphs.map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>) : <p>Question text, diagrams, tables, or image-only content will preview here.</p>}
            {selectedQuestionAsset ? <img className="a4-question-image" src={`${API_BASE}${selectedQuestionAsset.preview_url}`} alt={selectedQuestionAsset.original_name} /> : null}
            <div className={`option-preview-grid layout-${optionLayout}`}>
              {options.map((option) => (
                <span className={correctOption === option.label ? "correct" : ""} key={option.label}>
                  <b>{option.label}.</b> {option.text || (option.assetId ? "" : "Answer option")}
                  {option.assetId ? <img className="a4-option-image" src={`${API_BASE}${assets.find((asset) => asset.id === option.assetId)?.preview_url ?? ""}`} alt={`${option.label} option`} /> : null}
                </span>
              ))}
            </div>
          </div>
          <div className="metadata-mini">
            <span><Check size={15} />{reviewStatus.replace("_", " ")}</span>
            <span>{marks} mark</span>
            <span>{optionLayout.replace("_", " ")}</span>
          </div>
        </aside>
      </section>
    </>
  );
}
