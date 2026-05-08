import { Check, GripVertical, Image, Plus, Save, Sigma, Table2, Text, Trash2, UploadCloud } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQAsset, MCQAssetListPayload, MCQMetadataPayload, MCQReviewStatus } from "../types";

type EditorStep = "layout" | "question" | "options" | "metadata" | "preview";
type ContentBlockType = "text" | "image" | "equation" | "table" | "note";
type ContentBlockDraft = { id: string; block_type: ContentBlockType; text: string; assetId: number | null; tableText: string };
type OptionDraft = { label: string; text: string; equation: string; assetId: number | null };
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
  blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; table_data?: { rows?: string[][] }; order: number }>;
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
  { value: "standard", title: "Standard paper", note: "Question blocks above options. Best default.", className: "standard" },
  { value: "image_above", title: "Diagram first", note: "Large graph or circuit before the text/options.", className: "image-above" },
  { value: "text_image_side", title: "Text + diagram", note: "Text and image share the question area.", className: "side-image" },
  { value: "image_only", title: "Image question", note: "Use when the question itself is a scan/diagram.", className: "image-only" },
  { value: "option_grid", title: "Image choices", note: "Good for graph/circuit/vector answer choices.", className: "option-grid" },
  { value: "table_options", title: "Table choices", note: "Use when A-D are rows in a table.", className: "table-options" },
  { value: "compact", title: "Compact", note: "Tighter layout for short text questions.", className: "compact" },
];

const optionLayoutVisuals = [
  { value: "single", title: "Single column", className: "single" },
  { value: "two_column", title: "Two columns", className: "two-column" },
  { value: "four_column", title: "Four columns", className: "four-column" },
  { value: "grid", title: "Image grid", className: "grid" },
  { value: "table", title: "Table", className: "table" },
];

const newId = () => Math.random().toString(36).slice(2);

const defaultBlocks: ContentBlockDraft[] = [{ id: newId(), block_type: "text", text: "", assetId: null, tableText: "" }];

const defaultOptions: OptionDraft[] = [
  { label: "A", text: "", equation: "", assetId: null },
  { label: "B", text: "", equation: "", assetId: null },
  { label: "C", text: "", equation: "", assetId: null },
  { label: "D", text: "", equation: "", assetId: null },
];

export function MCQAddQuestionView({ questionId, onSaved }: { questionId?: number | null; onSaved: () => void }) {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [step, setStep] = useState<EditorStep>("layout");
  const [blocks, setBlocks] = useState<ContentBlockDraft[]>(defaultBlocks);
  const [assets, setAssets] = useState<MCQAsset[]>([]);
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

  function tableTextFromRows(rows?: string[][]) {
    return rows?.map((row) => row.join(" | ")).join("\n") ?? "";
  }

  function tableRowsFromText(text: string) {
    return text.split("\n").map((row) => row.split("|").map((cell) => cell.trim())).filter((row) => row.some(Boolean));
  }

  function loadQuestionIntoForm(question: MCQQuestionDetailPayload) {
    const nextBlocks = question.blocks.length
      ? question.blocks
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((block) => ({
            id: newId(),
            block_type: (block.block_type === "mixed" ? "text" : block.block_type) as ContentBlockType,
            text: block.text || "",
            assetId: block.asset_id,
            tableText: tableTextFromRows(block.table_data?.rows),
          }))
      : defaultBlocks;
    question.blocks.forEach((block) => {
      if (block.asset) setAssets((current) => (current.some((asset) => asset.id === block.asset?.id) ? current : [block.asset!, ...current]));
    });
    setBlocks(nextBlocks);
    setCorrectOption(question.options.find((option) => option.is_correct)?.label ?? "A");
    setMarks(question.marks ?? 1);
    setOptions(
      question.options.length
        ? question.options
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((option) => {
              const textBlock = option.blocks.find((block) => block.block_type === "text");
              const equationBlock = option.blocks.find((block) => block.block_type === "equation");
              const imageBlock = option.blocks.find((block) => block.block_type === "image" && block.asset_id);
              if (imageBlock?.asset) setAssets((current) => (current.some((asset) => asset.id === imageBlock.asset?.id) ? current : [imageBlock.asset!, ...current]));
              return { label: option.label, text: textBlock?.text ?? "", equation: equationBlock?.text ?? "", assetId: imageBlock?.asset_id ?? null };
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
    const defaults: LastMetadataDefaults = { subject, syllabus, examCode, paperCode, session, year, source, difficulty, reviewStatus, topicIds, subtopicIds, tagIds };
    localStorage.setItem(metadataDefaultsKey, JSON.stringify(defaults));
  }

  function blockHasContent(block: ContentBlockDraft) {
    return Boolean(block.text.trim() || block.assetId || tableRowsFromText(block.tableText).length);
  }

  function buildAutomaticTitle() {
    const sourceLabel = [examCode, sourceQuestionNumber].filter(Boolean).join(" ");
    if (sourceLabel) return sourceLabel;
    const firstText = blocks.map((block) => block.text).join(" ").replace(/\s+/g, " ").trim();
    if (firstText) return firstText.slice(0, 90);
    return assets.find((asset) => asset.id === blocks.find((block) => block.assetId)?.assetId)?.original_name || "Image-only MCQ question";
  }

  function updateBlock(id: string, patch: Partial<ContentBlockDraft>) {
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function addBlock(block_type: ContentBlockType) {
    setBlocks((current) => [...current, { id: newId(), block_type, text: "", assetId: null, tableText: block_type === "table" ? "heading 1 | heading 2\nvalue | value" : "" }]);
  }

  function removeBlock(id: string) {
    setBlocks((current) => (current.length <= 1 ? current : current.filter((block) => block.id !== id)));
  }

  function moveBlock(id: string, direction: -1 | 1) {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? { ...option, ...patch } : option)));
  }

  function addOption() {
    const nextLabel = String.fromCharCode(65 + options.length);
    setOptions((current) => [...current, { label: nextLabel, text: "", equation: "", assetId: null }]);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    const removedLabel = options[index].label;
    const nextOptions = options.filter((_, optionIndex) => optionIndex !== index);
    setOptions(nextOptions);
    if (correctOption === removedLabel) setCorrectOption(nextOptions[0]?.label ?? "A");
  }

  function toggleNumberValue(value: number, selected: number[], setter: (values: number[]) => void) {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  function questionPayloadBlocks() {
    return blocks.filter(blockHasContent).map((block, order) => ({
      block_type: block.block_type,
      text: block.text,
      asset_id: block.assetId,
      table_data: block.block_type === "table" ? { rows: tableRowsFromText(block.tableText) } : {},
      order: order + 1,
    }));
  }

  function optionPayloadBlocks() {
    return Object.fromEntries(options.map((option) => [
      option.label,
      [
        option.text.trim() ? { block_type: "text", text: option.text, order: 1 } : null,
        option.equation.trim() ? { block_type: "equation", text: option.equation, order: 2 } : null,
        option.assetId ? { block_type: "image", asset_id: option.assetId, order: 3 } : null,
      ].filter(Boolean),
    ]));
  }

  async function saveQuestion(stayOnPage = false) {
    setStatus(null);
    setError(null);
    if (!blocks.some(blockHasContent)) {
      setError("Add at least one question content block before saving.");
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
      const response = await fetch(questionId ? `${API_BASE}/api/mcq/questions/${questionId}/update/` : `${API_BASE}/api/mcq/questions/create/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: buildAutomaticTitle(),
          question_blocks: questionPayloadBlocks(),
          correct_option: correctOption,
          marks,
          option_labels: options.map((option) => option.label),
          option_texts: Object.fromEntries(options.map((option) => [option.label, option.text])),
          option_asset_ids: Object.fromEntries(options.filter((option) => option.assetId).map((option) => [option.label, option.assetId])),
          option_blocks: optionPayloadBlocks(),
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
      if (stayOnPage) resetForm();
      else onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save question.");
    } finally {
      setIsSaving(false);
    }
  }

  function resetForm() {
    setBlocks(defaultBlocks.map((block) => ({ ...block, id: newId() })));
    setCorrectOption("A");
    setMarks(1);
    setOptions(defaultOptions);
    setStep("layout");
    setSourceQuestionNumber("");
    setNotes("");
    setTeacherNotes("");
    if (!questionId) applyMetadataDefaults();
  }

  async function uploadAsset(file: File | null, assetType: "question" | "option", onDone: (asset: MCQAsset) => void) {
    if (!file) return;
    setError(null);
    setStatus(null);
    setIsUploadingAsset(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("asset_type", assetType);
      const response = await fetch(`${API_BASE}/api/mcq/assets/upload/`, { method: "POST", body: formData });
      const asset = await readJson<MCQAsset>(response);
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      onDone(asset);
      setStatus("Image uploaded and attached.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload image.");
    } finally {
      setIsUploadingAsset(false);
    }
  }

  function renderMathText(text: string): ReactNode[] {
    const pieces = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g).filter(Boolean);
    return pieces.map((piece, index) => {
      const display = piece.startsWith("$$") && piece.endsWith("$$");
      const inline = piece.startsWith("$") && piece.endsWith("$");
      if (!display && !inline) return <span key={index}>{piece}</span>;
      const clean = piece.replace(/^\${1,2}|\${1,2}$/g, "");
      return <span className={display ? "math-render display" : "math-render"} key={index}>{formatLatex(clean)}</span>;
    });
  }

  function formatLatex(value: string) {
    return value
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
      .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
      .replace(/\\times/g, "x")
      .replace(/\\pi/g, "π")
      .replace(/\\theta/g, "θ")
      .replace(/\\Delta/g, "Δ")
      .replace(/\^2/g, "²")
      .replace(/\^3/g, "³")
      .replace(/_/g, "");
  }

  function renderBlock(block: ContentBlockDraft) {
    const asset = assets.find((item) => item.id === block.assetId);
    if (block.block_type === "image") return asset ? <img className="a4-question-image" src={`${API_BASE}${asset.preview_url}`} alt={asset.original_name} /> : <p className="muted-preview">Image block</p>;
    if (block.block_type === "equation") return <div className="math-render display">{formatLatex(block.text || "F = ma")}</div>;
    if (block.block_type === "table") {
      const rows = tableRowsFromText(block.tableText);
      return rows.length ? <table className="mcq-preview-table"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderMathText(cell)}</td>)}</tr>)}</tbody></table> : <p className="muted-preview">Table block</p>;
    }
    if (block.block_type === "note") return <p className="mcq-note-preview">{renderMathText(block.text || "Teacher note")}</p>;
    return <p>{block.text ? renderMathText(block.text) : "Question text block"}</p>;
  }

  function renderOption(option: OptionDraft) {
    const asset = assets.find((item) => item.id === option.assetId);
    return (
      <>
        <b>{option.label}.</b>
        {option.text ? <span className="option-text-fragment">{renderMathText(option.text)}</span> : null}
        {option.equation ? <span className="math-render">{formatLatex(option.equation)}</span> : null}
        {asset ? <img className="a4-option-image" src={`${API_BASE}${asset.preview_url}`} alt={`${option.label} option`} /> : null}
        {!option.text && !option.equation && !asset ? <span className="option-text-fragment">Answer option</span> : null}
      </>
    );
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>{questionId ? "Edit MCQ Question" : "Add MCQ Question"}</h1>
          <span className="header-subtitle">Choose a layout, add content blocks, then save a reusable MCQ.</span>
        </div>
        <button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(false)}><Save size={17} />Save question</button>
      </section>

      <section className="mcq-editor-grid">
        <div className="panel mcq-editor-panel refined">
          <div className="step-tabs">{stepLabels.map((item) => <button className={step === item.value ? "active" : ""} key={item.value} onClick={() => setStep(item.value)}>{item.label}</button>)}</div>
          {status ? <div className="callout success">{status}</div> : null}
          {error ? <div className="callout error">{error}</div> : null}

          {step === "layout" ? (
            <div className="mcq-step-panel">
              <div className="section-intro compact"><strong>Pick the visual structure first</strong><span>The editor and preview will follow this structure while you enter the question.</span></div>
              <div className="layout-card-grid">{layoutVisuals.map((item) => <button className={`layout-choice-card ${layoutPreset === item.value ? "active" : ""}`} key={item.value} onClick={() => setLayoutPreset(item.value)} type="button"><span className={`layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span><strong>{item.title}</strong><small>{item.note}</small></button>)}</div>
              <div className="section-intro compact"><strong>Answer choice arrangement</strong><span>Choose how A-D will be arranged on the generated paper.</span></div>
              <div className="option-layout-card-grid">{optionLayoutVisuals.map((item) => <button className={`option-layout-card ${optionLayout === item.value ? "active" : ""}`} key={item.value} onClick={() => setOptionLayout(item.value)} type="button"><span className={`option-layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span><strong>{item.title}</strong></button>)}</div>
              <div className="option-entry-grid">
                <label className="field-stack"><span>Marks</span><input type="number" min={0} value={marks} onChange={(event) => setMarks(Number(event.target.value || 1))} /></label>
                <label className="field-stack"><span>Review status</span><select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as MCQReviewStatus)}>{metadata?.review_statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              </div>
            </div>
          ) : null}

          {step === "question" ? (
            <div className="mcq-step-panel">
              <div className="block-toolbar">
                <button onClick={() => addBlock("text")}><Text size={16} />Text</button>
                <button onClick={() => addBlock("equation")}><Sigma size={16} />Equation</button>
                <button onClick={() => addBlock("image")}><Image size={16} />Image</button>
                <button onClick={() => addBlock("table")}><Table2 size={16} />Table</button>
                <button onClick={() => addBlock("note")}><Plus size={16} />Note</button>
              </div>
              <div className="content-block-list">
                {blocks.map((block, index) => (
                  <div className="content-block-card" key={block.id}>
                    <div className="content-block-head">
                      <GripVertical size={16} />
                      <strong>{block.block_type === "text" ? "Text paragraph" : block.block_type === "equation" ? "Equation" : block.block_type === "image" ? "Image" : block.block_type === "table" ? "Table" : "Teacher note"}</strong>
                      <button className="mini-step-button" disabled={index === 0} onClick={() => moveBlock(block.id, -1)}>Up</button>
                      <button className="mini-step-button" disabled={index === blocks.length - 1} onClick={() => moveBlock(block.id, 1)}>Down</button>
                      <button className="icon-button danger-icon" disabled={blocks.length <= 1} onClick={() => removeBlock(block.id)}><Trash2 size={15} /></button>
                    </div>
                    {block.block_type === "text" || block.block_type === "note" ? <textarea value={block.text} onChange={(event) => updateBlock(block.id, { text: event.target.value })} placeholder="Write the paragraph. Inline maths can use $v = u + at$." /> : null}
                    {block.block_type === "equation" ? <input value={block.text} onChange={(event) => updateBlock(block.id, { text: event.target.value })} placeholder="Example: F = \\frac{mv^2}{r}" /> : null}
                    {block.block_type === "table" ? <textarea value={block.tableText} onChange={(event) => updateBlock(block.id, { tableText: event.target.value })} placeholder="Column 1 | Column 2&#10;value | value" /> : null}
                    {block.block_type === "image" ? (
                      <div className="asset-controls">
                        <label className="compact-upload-button"><UploadCloud size={16} />{isUploadingAsset ? "Uploading..." : "Upload image"}<input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadAsset(event.target.files?.[0] ?? null, "question", (asset) => updateBlock(block.id, { assetId: asset.id }))} /></label>
                        <select value={block.assetId ?? ""} onChange={(event) => updateBlock(block.id, { assetId: event.target.value ? Number(event.target.value) : null })}><option value="">No image attached</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.original_name}</option>)}</select>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {step === "options" ? (
            <div className="mcq-step-panel">
              <div className="option-editor-list">{options.map((option, index) => (
                <div className={`option-editor-card ${correctOption === option.label ? "correct" : ""}`} key={option.label}>
                  <div className="option-card-head"><button className="option-letter" onClick={() => setCorrectOption(option.label)} title="Mark as correct">{option.label}</button><strong>{correctOption === option.label ? "Correct answer" : "Answer option"}</strong><button className="icon-button" disabled={options.length <= 2} onClick={() => removeOption(index)}><Trash2 size={15} /></button></div>
                  <textarea value={option.text} onChange={(event) => updateOption(index, { text: event.target.value })} placeholder={`Option ${option.label} text. Inline maths can use $\\frac{1}{2}mv^2$.`} />
                  <input className="option-equation-input" value={option.equation} onChange={(event) => updateOption(index, { equation: event.target.value })} placeholder="Optional separate equation, e.g. E = mc^2" />
                  <div className="option-asset-row"><label className="compact-upload-button"><UploadCloud size={15} />Upload image<input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadAsset(event.target.files?.[0] ?? null, "option", (asset) => updateOption(index, { assetId: asset.id }))} /></label><select value={option.assetId ?? ""} onChange={(event) => updateOption(index, { assetId: event.target.value ? Number(event.target.value) : null })}><option value="">No option image</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.original_name}</option>)}</select>{option.assetId ? <button className="secondary-action" type="button" onClick={() => updateOption(index, { assetId: null })}>Remove</button> : null}</div>
                </div>
              ))}</div>
              <button className="secondary-action" onClick={addOption}><Plus size={16} />Add option</button>
            </div>
          ) : null}

          {step === "metadata" ? (
            <div className="mcq-step-panel">
              <div className="section-intro compact"><strong>Source metadata</strong><span>These values reuse the last saved question by default. Change only what is different.</span></div>
              {!sourceQuestionNumber.trim() ? <div className="callout warning">Original question number is empty. TeacherDesk will ask for confirmation before saving.</div> : null}
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
              <div className="metadata-picker"><strong>Topics</strong><div className="checkbox-chip-grid">{metadata?.topics.map((topic) => <label key={topic.id}><input type="checkbox" checked={topicIds.includes(topic.id)} onChange={() => toggleNumberValue(topic.id, topicIds, setTopicIds)} />{topic.name}</label>)}</div></div>
              {visibleSubtopics.length ? <div className="metadata-picker"><strong>Subtopics</strong><div className="checkbox-chip-grid">{visibleSubtopics.map((subtopic) => <label key={subtopic.id}><input type="checkbox" checked={subtopicIds.includes(subtopic.id)} onChange={() => toggleNumberValue(subtopic.id, subtopicIds, setSubtopicIds)} />{subtopic.name}</label>)}</div></div> : null}
              <div className="metadata-picker"><strong>Tags</strong><div className="checkbox-chip-grid">{metadata?.tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggleNumberValue(tag.id, tagIds, setTagIds)} />{tag.name}</label>)}</div></div>
              <label className="field-stack"><span>Teacher notes</span><textarea value={teacherNotes} onChange={(event) => setTeacherNotes(event.target.value)} placeholder="Private notes for review, source details, or teaching remarks." /></label>
            </div>
          ) : null}

          {step === "preview" ? <div className="mcq-step-panel"><div className="save-summary"><div><strong>{buildAutomaticTitle()}</strong><span>{marks} mark / {options.length} options / {reviewStatus.replace("_", " ")}</span></div><div><strong>Layout</strong><span>{layoutPreset} / {optionLayout}</span></div><div><strong>Metadata</strong><span>{topicIds.length} topics / {tagIds.length} tags</span></div></div><label className="field-stack"><span>General notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes stored with this question." /></label></div> : null}

          <div className="mcq-bottom-controls"><button className="secondary-action" disabled={step === "layout"} onClick={() => setStep(stepLabels[Math.max(stepLabels.findIndex((item) => item.value === step) - 1, 0)].value)}>Back</button><button className="secondary-action" disabled={step === "preview"} onClick={() => setStep(stepLabels[Math.min(stepLabels.findIndex((item) => item.value === step) + 1, stepLabels.length - 1)].value)}>Continue</button><button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(true)}><Plus size={16} />Save and add another</button></div>
        </div>

        <aside className="panel mcq-preview-panel sticky-preview">
          <div className="dashboard-widget-head"><div><strong>A4 live preview</strong><span>Student-facing layout, using your selected structure.</span></div></div>
          <div className={`a4-preview-card mcq-layout-${layoutPreset}`}>
            <div className="paper-question-number">1</div>
            <div className="question-block-preview">{blocks.filter(blockHasContent).length ? blocks.filter(blockHasContent).map((block) => <div className={`preview-content-block ${block.block_type}`} key={block.id}>{renderBlock(block)}</div>) : <p className="muted-preview">Add text, equation, image, or table blocks to build the question.</p>}</div>
            <div className={`option-preview-grid layout-${optionLayout}`}>{options.map((option) => <span className={correctOption === option.label ? "correct" : ""} key={option.label}>{renderOption(option)}</span>)}</div>
          </div>
          <div className="metadata-mini"><span><Check size={15} />{reviewStatus.replace("_", " ")}</span><span>{marks} mark</span><span>{optionLayout.replace("_", " ")}</span></div>
        </aside>
      </section>
    </>
  );
}
