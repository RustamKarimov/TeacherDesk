import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Heading2, Image, Italic, List, Plus, Redo2, Save, Sigma, Table2, Trash2, Underline, Undo2, UploadCloud } from "lucide-react";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapImage from "@tiptap/extension-image";
import { Table as TiptapTable } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import TiptapUnderline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { API_BASE, readJson } from "../api";
import type { MCQAsset, MCQAssetListPayload, MCQMetadataPayload, MCQReviewStatus } from "../types";

type EditorStep = "layout" | "question" | "options" | "metadata";
type ContentBlockType = "text" | "image" | "equation" | "table" | "note";
type ContentBlockDraft = { id: string; block_type: ContentBlockType; text: string; assetId: number | null; tableText: string };
type OptionDraft = { label: string; text: string; equation: string; assetId: number | null; imageWidth: number; imageFit: "contain" | "cover" };
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
  layout_settings: { rich_content?: JSONContent; rich_text?: string; rich_html?: string };
  blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; table_data?: { rows?: string[][] }; order: number }>;
  options: Array<{
    label: string;
    is_correct: boolean;
    order: number;
    layout_settings: { table_headers?: string[]; table_cells?: string[] };
    blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; order: number; settings?: { width?: number; fit?: "contain" | "cover" } }>;
  }>;
};

const stepLabels: Array<{ value: EditorStep; label: string }> = [
  { value: "layout", label: "Layout" },
  { value: "question", label: "Question" },
  { value: "options", label: "Options" },
  { value: "metadata", label: "Metadata" },
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

const defaultRichContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [],
    },
  ],
};

const defaultOptions: OptionDraft[] = [
  { label: "A", text: "", equation: "", assetId: null, imageWidth: 100, imageFit: "contain" },
  { label: "B", text: "", equation: "", assetId: null, imageWidth: 100, imageFit: "contain" },
  { label: "C", text: "", equation: "", assetId: null, imageWidth: 100, imageFit: "contain" },
  { label: "D", text: "", equation: "", assetId: null, imageWidth: 100, imageFit: "contain" },
];

const defaultTableHeaders = ["Column 1", "Column 2", "Column 3", "Column 4"];
const defaultTableRows: Record<string, string[]> = {
  A: ["", "", "", ""],
  B: ["", "", "", ""],
  C: ["", "", "", ""],
  D: ["", "", "", ""],
};

const equationSnippets = [
  { label: "a/b", value: "\\frac{a}{b}", title: "Fraction" },
  { label: "x²", value: "x^{2}", title: "Power" },
  { label: "xₙ", value: "x_{n}", title: "Subscript" },
  { label: "√x", value: "\\sqrt{x}", title: "Square root" },
  { label: "F⃗", value: "\\vec{F}", title: "Vector" },
  { label: "θ", value: "\\theta", title: "Theta" },
  { label: "Δ", value: "\\Delta", title: "Delta" },
  { label: "π", value: "\\pi", title: "Pi" },
  { label: "Σ", value: "\\sum_{i=1}^{n}", title: "Summation" },
  { label: "∫", value: "\\int_{a}^{b}", title: "Integral" },
  { label: "lim", value: "\\lim_{x\\to 0}", title: "Limit" },
  { label: "[ ]", value: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", title: "Matrix" },
];

export function MCQAddQuestionView({ questionId, onSaved }: { questionId?: number | null; onSaved: () => void }) {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [step, setStep] = useState<EditorStep>("layout");
  const [blocks, setBlocks] = useState<ContentBlockDraft[]>(defaultBlocks);
  const [richContent, setRichContent] = useState<JSONContent>(defaultRichContent);
  const [richHtml, setRichHtml] = useState("");
  const [richText, setRichText] = useState("");
  const [assets, setAssets] = useState<MCQAsset[]>([]);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [correctOption, setCorrectOption] = useState("A");
  const [marks, setMarks] = useState(1);
  const [options, setOptions] = useState<OptionDraft[]>(defaultOptions);
  const [tableHeaders, setTableHeaders] = useState<string[]>(defaultTableHeaders);
  const [tableRows, setTableRows] = useState<Record<string, string[]>>(defaultTableRows);
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
  const editorScaleRef = useRef<HTMLDivElement | null>(null);
  const previewScaleRef = useRef<HTMLDivElement | null>(null);
  const [editorScale, setEditorScale] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);

  const visibleSubtopics = useMemo(() => {
    const selectedTopics = metadata?.topics.filter((topic) => topicIds.includes(topic.id)) ?? [];
    return selectedTopics.flatMap((topic) => topic.subtopics.map((subtopic) => ({ ...subtopic, topicName: topic.name })));
  }, [metadata, topicIds]);

  useEffect(() => {
    const pageWidth = 794;
    const pageHeight = 1123;
    const observe = (element: HTMLDivElement | null, setter: (value: number) => void, includeHeight = false) => {
      if (!element) return undefined;
      const resize = () => {
        const widthScale = Math.max(Math.min((element.clientWidth - 28) / pageWidth, 1), 0.32);
        const heightScale = includeHeight ? Math.max(Math.min((element.clientHeight - 28) / pageHeight, 1), 0.32) : 1;
        setter(Math.min(widthScale, heightScale));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      return () => observer.disconnect();
    };
    const cleanupEditor = observe(editorScaleRef.current, setEditorScale);
    const cleanupPreview = observe(previewScaleRef.current, setPreviewScale, true);
    return () => {
      cleanupEditor?.();
      cleanupPreview?.();
    };
  }, [step]);

  const richEditor = useEditor({
    extensions: [
      StarterKit,
      TiptapUnderline,
      Placeholder.configure({
        placeholder: "Write the question here. Use $v = u + at$ for inline equations, or insert images and tables from the toolbar.",
      }),
      TiptapImage.configure({ allowBase64: false, inline: false }),
      TiptapTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: richContent,
    editorProps: {
      attributes: {
        class: "a4-rich-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      setRichContent(editor.getJSON());
      setRichHtml(editor.getHTML());
      setRichText(editor.getText({ blockSeparator: "\n" }));
    },
  });

  useEffect(() => {
    if (!richEditor) return;
    richEditor.commands.setContent(richContent);
    setRichHtml(richEditor.getHTML());
    setRichText(richEditor.getText({ blockSeparator: "\n" }));
  }, [richEditor]);

  useEffect(() => {
    const visibleIds = new Set(visibleSubtopics.map((subtopic) => subtopic.id));
    setSubtopicIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [visibleSubtopics]);

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

  function setRichEditorContent(content: JSONContent) {
    setRichContent(content);
    if (richEditor) {
      richEditor.commands.setContent(content);
      setRichHtml(richEditor.getHTML());
      setRichText(richEditor.getText({ blockSeparator: "\n" }));
    }
  }

  function richContentHasContent(content = richContent) {
    const walk = (node?: JSONContent): boolean => {
      if (!node) return false;
      if (typeof node.text === "string" && node.text.trim()) return true;
      if (node.type === "image" && typeof node.attrs?.src === "string" && node.attrs.src) return true;
      return Array.isArray(node.content) ? node.content.some(walk) : false;
    };
    return walk(content);
  }

  function richPlainText(content = richContent): string {
    const parts: string[] = [];
    const walk = (node?: JSONContent) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") parts.push("\n");
      node.content?.forEach(walk);
      if (node.type === "tableRow") parts.push("\n");
    };
    walk(content);
    return parts.join(" ").replace(/[ \t]+\n/g, "\n").replace(/\s+/g, " ").trim();
  }

  function blocksToRichContent(sourceBlocks: ContentBlockDraft[]): JSONContent {
    const content = sourceBlocks.filter(blockHasContent).flatMap((block): JSONContent[] => {
      const asset = block.assetId ? assets.find((item) => item.id === block.assetId) : null;
      if (block.block_type === "image" && asset) return [{ type: "image", attrs: { src: `${API_BASE}${asset.preview_url}`, alt: asset.original_name } }];
      if (block.block_type === "equation") return [{ type: "paragraph", content: [{ type: "text", text: `$$${block.text}$$` }] }];
      if (block.block_type === "table") {
        const rows = tableRowsFromText(block.tableText);
        return rows.length
          ? [{
              type: "table",
              content: rows.map((row) => ({
                type: "tableRow",
                content: row.map((cell) => ({ type: "tableCell", content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : [] }] })),
              })),
            }]
          : [];
      }
      return block.text
        ? block.text.split(/\n{2,}/).filter(Boolean).map((paragraph) => ({ type: "paragraph", content: [{ type: "text", text: paragraph.trim() }] }))
        : [];
    });
    return { type: "doc", content: content.length ? content : defaultRichContent.content };
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
    setRichEditorContent(question.layout_settings?.rich_content || blocksToRichContent(nextBlocks));
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
              return {
                label: option.label,
                text: textBlock?.text ?? "",
                equation: equationBlock?.text ?? "",
                assetId: imageBlock?.asset_id ?? null,
                imageWidth: imageBlock?.settings?.width ?? 100,
                imageFit: imageBlock?.settings?.fit ?? "contain",
              };
            })
        : defaultOptions,
    );
    const tableOptions = question.options.filter((option) => option.layout_settings?.table_cells?.length);
    if (tableOptions.length) {
      setTableHeaders(tableOptions[0].layout_settings.table_headers?.length ? tableOptions[0].layout_settings.table_headers! : defaultTableHeaders);
      setTableRows(Object.fromEntries(tableOptions.map((option) => [option.label, option.layout_settings.table_cells ?? []])));
    } else {
      setTableHeaders(defaultTableHeaders);
      setTableRows(defaultTableRows);
    }
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
    const firstText = richPlainText() || blocks.map((block) => block.text).join(" ").replace(/\s+/g, " ").trim();
    if (firstText) return firstText.slice(0, 90);
    return assets.find((asset) => asset.id === blocks.find((block) => block.assetId)?.assetId)?.original_name || "Image-only MCQ question";
  }

  function updateBlock(id: string, patch: Partial<ContentBlockDraft>) {
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function insertIntoBlock(id: string, snippet: string) {
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, text: `${block.text}${block.text ? " " : ""}${snippet}` } : block)));
  }

  function insertIntoOptionEquation(index: number, snippet: string) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? { ...option, equation: `${option.equation}${option.equation ? " " : ""}${snippet}` } : option)));
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
    setOptions((current) => [...current, { label: nextLabel, text: "", equation: "", assetId: null, imageWidth: 100, imageFit: "contain" }]);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    const removedLabel = options[index].label;
    const nextOptions = options.filter((_, optionIndex) => optionIndex !== index);
    setOptions(nextOptions);
    setTableRows((current) => Object.fromEntries(Object.entries(current).filter(([label]) => label !== removedLabel)));
    if (correctOption === removedLabel) setCorrectOption(nextOptions[0]?.label ?? "A");
  }

  function updateTableHeader(index: number, value: string) {
    setTableHeaders((current) => current.map((header, headerIndex) => (headerIndex === index ? value : header)));
  }

  function addTableColumn() {
    setTableHeaders((current) => [...current, `column ${current.length + 1}`]);
    setTableRows((current) => Object.fromEntries(options.map((option) => [option.label, [...(current[option.label] ?? []), ""]])));
  }

  function removeTableColumn(index: number) {
    if (tableHeaders.length <= 1) return;
    setTableHeaders((current) => current.filter((_, headerIndex) => headerIndex !== index));
    setTableRows((current) => Object.fromEntries(options.map((option) => [option.label, (current[option.label] ?? []).filter((_, cellIndex) => cellIndex !== index)])));
  }

  function updateTableCell(label: string, columnIndex: number, value: string) {
    setTableRows((current) => {
      const row = [...(current[label] ?? Array.from({ length: tableHeaders.length }, () => ""))];
      row[columnIndex] = value;
      return { ...current, [label]: row };
    });
  }

  function toggleNumberValue(value: number, selected: number[], setter: (values: number[]) => void) {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  function questionPayloadBlocks() {
    const text = richPlainText();
    if (text) return [{ block_type: "text", text, asset_id: null, table_data: {}, order: 1 }];
    return blocks.filter(blockHasContent).map((block, order) => ({
      block_type: block.block_type,
      text: block.text,
      asset_id: block.assetId,
      table_data: block.block_type === "table" ? { rows: tableRowsFromText(block.tableText) } : {},
      order: order + 1,
    }));
  }

  function optionTablePayload() {
    if (optionLayout !== "table") return {};
    return {
      headers: tableHeaders,
      rows: Object.fromEntries(options.map((option) => [
        option.label,
        tableHeaders.map((_, index) => tableRows[option.label]?.[index] ?? ""),
      ])),
    };
  }

  function optionPayloadBlocks() {
    return Object.fromEntries(options.map((option) => [
      option.label,
      [
        option.text.trim() ? { block_type: "text", text: option.text, order: 1 } : null,
        option.equation.trim() ? { block_type: "equation", text: option.equation, order: 2 } : null,
        option.assetId ? { block_type: "image", asset_id: option.assetId, order: 3, settings: { width: option.imageWidth, fit: option.imageFit } } : null,
      ].filter(Boolean),
    ]));
  }

  async function saveQuestion(stayOnPage = false) {
    setStatus(null);
    setError(null);
    if (!richContentHasContent() && !blocks.some(blockHasContent)) {
      setError("Add question content before saving. You can type, insert an equation, add an image, or add a table.");
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
          option_table: optionTablePayload(),
          layout_preset: layoutPreset,
          option_layout: optionLayout,
          layout_settings: {
            rich_content: richContent,
            rich_html: richHtml,
            rich_text: richText || richPlainText(),
          },
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
    setRichEditorContent(defaultRichContent);
    setCorrectOption("A");
    setMarks(1);
    setOptions(defaultOptions);
    setTableHeaders(defaultTableHeaders);
    setTableRows(defaultTableRows);
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

  function insertEditorMath(snippet: string, displayMode = false) {
    if (!richEditor) return;
    richEditor.chain().focus().insertContent(displayMode ? `\n$$${snippet}$$\n` : `$${snippet}$`).run();
  }

  function setEditorImageSize(width: number) {
    richEditor?.chain().focus().updateAttributes("image", { width }).run();
  }

  function setEditorImageFit(fit: "contain" | "cover") {
    richEditor?.chain().focus().updateAttributes("image", { "data-fit": fit }).run();
  }

  async function uploadEditorImage(file: File | null) {
    await uploadAsset(file, "question", (asset) => {
      richEditor?.chain().focus().setImage({ src: `${API_BASE}${asset.preview_url}`, alt: asset.original_name, width: 100 }).updateAttributes("image", { "data-fit": "contain" }).run();
    });
  }

  function renderMathText(text: string): ReactNode[] {
    const pieces = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g).filter(Boolean);
    return pieces.map((piece, index) => {
      const display = piece.startsWith("$$") && piece.endsWith("$$");
      const inline = piece.startsWith("$") && piece.endsWith("$");
      if (!display && !inline) return <span key={index}>{piece}</span>;
      const clean = piece.replace(/^\${1,2}|\${1,2}$/g, "");
      return <LatexMath latex={clean} displayMode={display} key={index} />;
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

  function renderLatexToHtml(latex: string, displayMode = false) {
    return katex.renderToString(latex || "\\square", {
      displayMode,
      throwOnError: false,
      strict: "warn",
      trust: false,
      output: "html",
    });
  }

  function LatexMath({ latex, displayMode = false }: { latex: string; displayMode?: boolean }) {
    return <span className={displayMode ? "math-render display" : "math-render"} dangerouslySetInnerHTML={{ __html: renderLatexToHtml(latex, displayMode) }} />;
  }

  function renderRichNode(node: JSONContent, key = "node"): ReactNode {
    const children = node.content?.map((child, index) => renderRichNode(child, `${key}-${index}`));
    if (node.type === "doc") return <>{children}</>;
    if (node.type === "paragraph") return <p key={key}>{children}</p>;
    if (node.type === "heading") {
      const level = Math.min(Number(node.attrs?.level || 2), 3);
      return level === 1 ? <h1 key={key}>{children}</h1> : level === 2 ? <h2 key={key}>{children}</h2> : <h3 key={key}>{children}</h3>;
    }
    if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (node.type === "orderedList") return <ol key={key}>{children}</ol>;
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "image") {
      const width = typeof node.attrs?.width === "number" ? `${node.attrs.width}%` : typeof node.attrs?.width === "string" ? node.attrs.width : "100%";
      const fit = node.attrs?.["data-fit"] === "cover" ? "cover" : "contain";
      return <img className={`a4-question-image fit-${fit}`} key={key} src={String(node.attrs?.src || "")} alt={String(node.attrs?.alt || "Question image")} style={{ width }} />;
    }
    if (node.type === "table") return <table className="mcq-preview-table rich-table" key={key}><tbody>{children}</tbody></table>;
    if (node.type === "tableRow") return <tr key={key}>{children}</tr>;
    if (node.type === "tableHeader") return <th key={key}>{children}</th>;
    if (node.type === "tableCell") return <td key={key}>{children}</td>;
    if (node.type === "text") {
      let rendered: ReactNode = renderMathText(node.text || "");
      if (node.marks?.some((mark) => mark.type === "bold")) rendered = <strong key={key}>{rendered}</strong>;
      if (node.marks?.some((mark) => mark.type === "italic")) rendered = <em key={key}>{rendered}</em>;
      if (node.marks?.some((mark) => mark.type === "underline")) rendered = <u key={key}>{rendered}</u>;
      return <span key={key}>{rendered}</span>;
    }
    return <span key={key}>{children}</span>;
  }

  function renderBlock(block: ContentBlockDraft) {
    const asset = assets.find((item) => item.id === block.assetId);
    if (block.block_type === "image") return asset ? <img className="a4-question-image" src={`${API_BASE}${asset.preview_url}`} alt={asset.original_name} /> : <p className="muted-preview">Image block</p>;
    if (block.block_type === "equation") return <LatexMath latex={block.text || "F = ma"} displayMode />;
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
        {option.equation ? <LatexMath latex={option.equation} /> : null}
        {asset ? <img className={`a4-option-image fit-${option.imageFit}`} src={`${API_BASE}${asset.preview_url}`} alt={`${option.label} option`} style={{ width: `${option.imageWidth}%` }} /> : null}
        {!option.text && !option.equation && !asset ? <span className="option-text-fragment">Answer option</span> : null}
      </>
    );
  }

  function renderOptionTablePreview() {
    return (
      <table className="mcq-answer-table-preview">
        <thead>
          <tr>
            <th />
            {tableHeaders.map((header, index) => <th key={index}>{renderMathText(header)}</th>)}
          </tr>
        </thead>
        <tbody>
          {options.map((option) => (
            <tr className={correctOption === option.label ? "correct" : ""} key={option.label}>
              <th>{option.label}</th>
              {tableHeaders.map((_, index) => <td key={index}>{renderMathText(tableRows[option.label]?.[index] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
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
              <div className="layout-card-grid">{layoutVisuals.map((item) => <button className={`layout-choice-card ${layoutPreset === item.value ? "active" : ""}`} key={item.value} onClick={() => { setLayoutPreset(item.value); if (item.value === "table_options") setOptionLayout("table"); if (item.value === "option_grid") setOptionLayout("grid"); }} type="button"><span className={`layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span><strong>{item.title}</strong><small>{item.note}</small></button>)}</div>
              <div className="section-intro compact"><strong>Answer choice arrangement</strong><span>Choose how A-D will be arranged on the generated paper.</span></div>
              <div className="option-layout-card-grid">{optionLayoutVisuals.map((item) => <button className={`option-layout-card ${optionLayout === item.value ? "active" : ""}`} key={item.value} onClick={() => { setOptionLayout(item.value); if (item.value === "table") setLayoutPreset("table_options"); if (item.value === "grid") setLayoutPreset("option_grid"); }} type="button"><span className={`option-layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span><strong>{item.title}</strong></button>)}</div>
              <div className="option-entry-grid">
                <label className="field-stack"><span>Marks</span><input type="number" min={0} value={marks} onChange={(event) => setMarks(Number(event.target.value || 1))} /></label>
                <label className="field-stack"><span>Review status</span><select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as MCQReviewStatus)}>{metadata?.review_statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              </div>
            </div>
          ) : null}

          {step === "question" ? (
            <div className="mcq-step-panel">
              <div className="section-intro compact"><strong>Write the question on the A4 canvas</strong><span>Type normally, insert equations with LaTeX shortcuts, and add images or tables where they belong.</span></div>
              <div className="rich-editor-shell">
                <div className="rich-editor-toolbar">
                  <button className={richEditor?.isActive("bold") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleBold().run()} title="Bold"><Bold size={16} /></button>
                  <button className={richEditor?.isActive("italic") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleItalic().run()} title="Italic"><Italic size={16} /></button>
                  <button className={richEditor?.isActive("underline") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleUnderline().run()} title="Underline"><Underline size={16} /></button>
                  <button className={richEditor?.isActive("heading", { level: 2 }) ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading"><Heading2 size={16} /></button>
                  <button className={richEditor?.isActive("bulletList") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleBulletList().run()} title="Bullet list"><List size={16} /></button>
                  <select className="rich-toolbar-select" defaultValue="" onChange={(event) => { if (event.target.value) richEditor?.chain().focus().toggleOrderedList().updateAttributes("orderedList", { type: event.target.value }).run(); event.target.value = ""; }} title="Numbering style">
                    <option value="">Numbering</option>
                    <option value="1">1, 2, 3</option>
                    <option value="a">a, b, c</option>
                    <option value="A">A, B, C</option>
                    <option value="i">i, ii, iii</option>
                    <option value="I">I, II, III</option>
                  </select>
                  <button type="button" onClick={() => richEditor?.chain().focus().setTextAlign("left").run()} title="Align left"><AlignLeft size={16} /></button>
                  <button type="button" onClick={() => richEditor?.chain().focus().setTextAlign("center").run()} title="Align center"><AlignCenter size={16} /></button>
                  <button type="button" onClick={() => richEditor?.chain().focus().setTextAlign("right").run()} title="Align right"><AlignRight size={16} /></button>
                  <button type="button" onClick={() => richEditor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table"><Table2 size={16} /></button>
                  <label className="rich-upload-button" title="Insert image"><Image size={16} /><input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadEditorImage(event.target.files?.[0] ?? null)} /></label>
                  <button type="button" onClick={() => richEditor?.chain().focus().undo().run()} title="Undo"><Undo2 size={16} /></button>
                  <button type="button" onClick={() => richEditor?.chain().focus().redo().run()} title="Redo"><Redo2 size={16} /></button>
                  <select className="rich-toolbar-select" defaultValue="" disabled={!richEditor?.isActive("image")} onChange={(event) => { if (event.target.value) setEditorImageSize(Number(event.target.value)); event.target.value = ""; }} title="Selected image width">
                    <option value="">Image size</option>
                    <option value="25">25%</option>
                    <option value="50">50%</option>
                    <option value="75">75%</option>
                    <option value="100">100%</option>
                  </select>
                  <select className="rich-toolbar-select" defaultValue="" disabled={!richEditor?.isActive("image")} onChange={(event) => { if (event.target.value === "contain" || event.target.value === "cover") setEditorImageFit(event.target.value); event.target.value = ""; }} title="Selected image crop mode">
                    <option value="">Image crop</option>
                    <option value="contain">Fit whole image</option>
                    <option value="cover">Crop to frame</option>
                  </select>
                </div>
                <div className="rich-equation-palette">
                  <span title="Inline equation shortcuts"><Sigma size={15} /></span>
                  {equationSnippets.map((snippet) => <button key={snippet.title} type="button" title={snippet.title} onClick={() => insertEditorMath(snippet.value)}>{snippet.label}</button>)}
                  <button type="button" onClick={() => insertEditorMath("\\frac{mv^2}{r}", true)}>Display</button>
                </div>
                <div className="a4-editor-stage" ref={editorScaleRef}>
                  <div className="a4-scale-shell" style={{ "--a4-scale": editorScale } as CSSProperties}>
                    <div className="a4-editor-page">
                      <EditorContent editor={richEditor} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step === "options" ? (
            <div className="mcq-step-panel">
              {optionLayout === "table" ? (
                <div className="table-option-editor">
                  <div className="section-intro compact"><strong>Table answer options</strong><span>Edit the headings and A-D row cells. Select the correct answer by clicking the row letter.</span></div>
                  <div className="table-editor-actions">
                    <button className="secondary-action" type="button" onClick={addTableColumn}><Plus size={15} />Add column</button>
                    <button className="secondary-action" type="button" onClick={() => setOptionLayout("single")}>Use normal options</button>
                  </div>
                  <div className="answer-table-editor-grid" style={{ gridTemplateColumns: `72px repeat(${tableHeaders.length}, minmax(140px, 1fr)) 44px` }}>
                    <div className="table-corner" />
                    {tableHeaders.map((header, index) => (
                      <input key={index} value={header} onChange={(event) => updateTableHeader(index, event.target.value)} placeholder={`heading ${index + 1}`} />
                    ))}
                    <div />
                  </div>
                  <div className="answer-table-body" style={{ gridTemplateColumns: `72px repeat(${tableHeaders.length}, minmax(140px, 1fr)) 44px` }}>
                    {options.flatMap((option) => [
                      <button className={`answer-row-select ${correctOption === option.label ? "correct" : ""}`} key={`${option.label}-select`} onClick={() => setCorrectOption(option.label)}>{option.label}</button>,
                      ...tableHeaders.map((_, index) => <input key={`${option.label}-${index}`} value={tableRows[option.label]?.[index] ?? ""} onChange={(event) => updateTableCell(option.label, index, event.target.value)} placeholder="cell value" />),
                      <button className="icon-button danger-icon" disabled={options.length <= 2} key={`${option.label}-delete`} onClick={() => removeOption(options.findIndex((item) => item.label === option.label))}><Trash2 size={15} /></button>,
                    ])}
                  </div>
                  <div className="table-column-removers" style={{ gridTemplateColumns: `72px repeat(${tableHeaders.length}, minmax(140px, 1fr)) 44px` }}>
                    <span />
                    {tableHeaders.map((_, index) => <button className="mini-step-button" disabled={tableHeaders.length <= 1} key={index} onClick={() => removeTableColumn(index)}>Remove</button>)}
                    <span />
                  </div>
                  <button className="secondary-action" onClick={addOption}><Plus size={16} />Add option row</button>
                </div>
              ) : (
                <>
                  <div className="option-editor-list">{options.map((option, index) => (
                <div className={`option-editor-card ${correctOption === option.label ? "correct" : ""}`} key={option.label}>
                  <div className="option-card-head"><button className="option-letter" onClick={() => setCorrectOption(option.label)} title="Mark as correct">{option.label}</button><strong>{correctOption === option.label ? "Correct answer" : "Answer option"}</strong><button className="icon-button" disabled={options.length <= 2} onClick={() => removeOption(index)}><Trash2 size={15} /></button></div>
                  <textarea value={option.text} onChange={(event) => updateOption(index, { text: event.target.value })} placeholder={`Option ${option.label} text. Inline maths can use $\\frac{1}{2}mv^2$.`} />
                  <div className="equation-editor compact">
                    <div className="equation-palette">{equationSnippets.slice(0, 8).map((snippet) => <button key={snippet.label} type="button" onClick={() => insertIntoOptionEquation(index, snippet.value)}>{snippet.label}</button>)}</div>
                    <input className="option-equation-input" value={option.equation} onChange={(event) => updateOption(index, { equation: event.target.value })} placeholder="Optional separate equation, e.g. E = mc^2" />
                  </div>
                  <div className="option-asset-row"><label className="compact-upload-button"><UploadCloud size={15} />Upload image<input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadAsset(event.target.files?.[0] ?? null, "option", (asset) => updateOption(index, { assetId: asset.id }))} /></label><select value={option.assetId ?? ""} onChange={(event) => updateOption(index, { assetId: event.target.value ? Number(event.target.value) : null })}><option value="">No option image</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.original_name}</option>)}</select>{option.assetId ? <button className="secondary-action" type="button" onClick={() => updateOption(index, { assetId: null })}>Remove</button> : null}</div>
                  {option.assetId ? <div className="option-image-tools"><label><span>Image width</span><input type="range" min="25" max="100" step="5" value={option.imageWidth} onChange={(event) => updateOption(index, { imageWidth: Number(event.target.value) })} /></label><select value={option.imageFit} onChange={(event) => updateOption(index, { imageFit: event.target.value === "cover" ? "cover" : "contain" })}><option value="contain">Fit whole image</option><option value="cover">Crop to frame</option></select></div> : null}
                </div>
                  ))}</div>
                  <button className="secondary-action" onClick={addOption}><Plus size={16} />Add option</button>
                </>
              )}
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
              <div className="metadata-picker"><strong>Topics</strong><div className="checkbox-chip-grid">{metadata?.topics.map((topic) => <button className={topicIds.includes(topic.id) ? "active" : ""} key={topic.id} type="button" onClick={() => toggleNumberValue(topic.id, topicIds, setTopicIds)}><Check size={14} />{topic.name}</button>)}</div></div>
              {visibleSubtopics.length ? <div className="metadata-picker"><strong>Subtopics</strong><div className="checkbox-chip-grid">{visibleSubtopics.map((subtopic) => <button className={subtopicIds.includes(subtopic.id) ? "active" : ""} key={subtopic.id} type="button" onClick={() => toggleNumberValue(subtopic.id, subtopicIds, setSubtopicIds)}><Check size={14} />{subtopic.name}</button>)}</div></div> : null}
              <div className="metadata-picker"><strong>Tags</strong><div className="checkbox-chip-grid">{metadata?.tags.map((tag) => <button className={tagIds.includes(tag.id) ? "active" : ""} key={tag.id} type="button" onClick={() => toggleNumberValue(tag.id, tagIds, setTagIds)}><Check size={14} />{tag.name}</button>)}</div></div>
              <label className="field-stack"><span>Teacher notes</span><textarea value={teacherNotes} onChange={(event) => setTeacherNotes(event.target.value)} placeholder="Private notes for review, source details, or teaching remarks." /></label>
            </div>
          ) : null}

          <div className="mcq-bottom-controls"><button className="secondary-action" disabled={step === "layout"} onClick={() => setStep(stepLabels[Math.max(stepLabels.findIndex((item) => item.value === step) - 1, 0)].value)}>Back</button><button className="secondary-action" disabled={step === "metadata"} onClick={() => setStep(stepLabels[Math.min(stepLabels.findIndex((item) => item.value === step) + 1, stepLabels.length - 1)].value)}>Continue</button><button className="secondary-action" disabled={isSaving} onClick={() => saveQuestion(false)}><Save size={16} />Save</button><button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(true)}><Plus size={16} />Save and add another</button></div>
        </div>

        <aside className="panel mcq-preview-panel sticky-preview">
          <div className="dashboard-widget-head"><div><strong>A4 live preview</strong><span>Student-facing layout, using your selected structure.</span></div></div>
          <div className="a4-preview-viewport" ref={previewScaleRef}>
            <div className="a4-scale-shell" style={{ "--a4-scale": previewScale } as CSSProperties}>
              <div className={`a4-preview-card mcq-layout-${layoutPreset}`}>
                <div className="paper-question-row">
                  <div className="paper-question-number">1</div>
                  <div className="paper-question-body">
                    <div className="question-block-preview rich-preview-content">{richContentHasContent() ? renderRichNode(richContent) : <p className="muted-preview">Write the question, insert equations, add images, or create a table.</p>}</div>
                    {optionLayout === "table" ? renderOptionTablePreview() : <div className={`option-preview-grid layout-${optionLayout}`}>{options.map((option) => <span className={correctOption === option.label ? "correct" : ""} key={option.label}>{renderOption(option)}</span>)}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="metadata-mini"><span><Check size={15} />{reviewStatus.replace("_", " ")}</span><span>{marks} mark</span><span>{optionLayout.replace("_", " ")}</span></div>
        </aside>
      </section>
    </>
  );
}
