import { AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Bold, Check, Heading2, Image, Italic, List, ListOrdered, Plus, Redo2, Save, Scaling, StretchHorizontal, StretchVertical, Table2, Trash2, Underline, Undo2, UploadCloud } from "lucide-react";
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
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { API_BASE, readJson } from "../api";
import type { MCQAsset, MCQAssetListPayload, MCQMetadataPayload, MCQReviewStatus } from "../types";
import { MCQA4Question, type MCQRenderOption } from "./MCQRenderer";

type EditorStep = "question" | "metadata";
type ContentBlockType = "text" | "image" | "table" | "note";
type ContentBlockDraft = { id: string; block_type: ContentBlockType; text: string; assetId: number | null; tableText: string };
type OptionDraft = {
  label: string;
  text: string;
  assetId: number | null;
  imageWidth: number;
  imageHeight: number;
  imageFit: "contain" | "cover";
  imageAlign: "left" | "center" | "right";
  imageOffsetX: number;
  imageOffsetY: number;
};
type ImageAlign = "left" | "center" | "right";
type OptionImagePlacement = "top" | "middle" | "bottom";
type OptionImageSizing = "individual" | "same_height" | "same_width" | "same_size";
type OptionLabelPlacement = "inline" | "above" | "below";
type OptionLabelAlign = "left" | "center" | "right";
type OptionContentAlign = "left" | "center" | "right";
type ExtractedOption = { label: string; text: string };
type RibbonMode = "text" | "image" | "table" | "optionGroup" | "optionTable" | "optionImage";
type EditorTableContext = Record<string, unknown>;
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
  layout_settings: {
    rich_content?: JSONContent;
    rich_text?: string;
    rich_html?: string;
    option_image_layout?: {
      placement?: OptionImagePlacement;
      sizing?: OptionImageSizing;
      label_placement?: OptionLabelPlacement;
      label_align?: OptionLabelAlign;
      content_align?: OptionContentAlign;
      table_borders?: boolean;
      table_headers?: boolean;
    };
    options_embedded?: boolean;
    paper_style?: {
      font_size_pt?: number;
      font_family?: string;
      equation_scale?: number;
      option_gap_px?: number;
      question_number_weight?: number;
    };
  };
  blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; table_data?: { rows?: string[][] }; order: number }>;
  options: Array<{
    label: string;
    is_correct: boolean;
    order: number;
    layout_settings: { table_headers?: string[]; table_cells?: string[]; table_cell_asset_ids?: Array<number | null> };
    blocks: Array<{ block_type: string; text: string; asset_id: number | null; asset: MCQAsset | null; order: number; settings?: { width?: number; height?: number; fit?: "contain" | "cover"; align?: "left" | "center" | "right"; offset_x?: number; offset_y?: number } }>;
  }>;
};

const stepLabels: Array<{ value: EditorStep; label: string }> = [
  { value: "question", label: "Question" },
];

const metadataDefaultsKey = "teacherdesk.mcq.lastMetadata";

const optionLayoutVisuals = [
  { value: "single", title: "Single", subtitle: "A-D stacked", className: "single" },
  { value: "two_column", title: "Two", subtitle: "2 x 2 choices", className: "two-column" },
  { value: "four_column", title: "Four", subtitle: "A B C D", className: "four-column" },
  { value: "table", title: "Table", subtitle: "A-D rows", className: "table" },
];

const answerLayoutModes = [
  {
    value: "standard",
    title: "Standard choices",
    subtitle: "A-D answers with text, equations, or images",
    layouts: ["single", "two_column", "four_column"],
  },
  {
    value: "table",
    title: "Answer table",
    subtitle: "A-D rows with optional heading columns",
    layouts: ["table"],
  },
];

const paperFontOptions = ["Calibri", "Arial", "Times New Roman", "Cambria", "Segoe UI"];

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

const createDefaultOption = (label: string): OptionDraft => ({
  label,
  text: "",
  assetId: null,
  imageWidth: 100,
  imageHeight: 0,
  imageFit: "contain",
  imageAlign: "center",
  imageOffsetX: 0,
  imageOffsetY: 0,
});

const defaultOptions: OptionDraft[] = ["A", "B", "C", "D"].map(createDefaultOption);

const defaultTableHeaders = ["Column 1", "Column 2", "Column 3", "Column 4"];
const defaultTableRows: Record<string, string[]> = {
  A: ["", "", "", ""],
  B: ["", "", "", ""],
  C: ["", "", "", ""],
  D: ["", "", "", ""],
};

const RichImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 100,
        parseHTML: (element) => Number(element.getAttribute("data-width") || element.getAttribute("width") || 100),
        renderHTML: (attributes) => ({
          "data-width": attributes.width,
          width: attributes.width,
          style: `width: ${attributes.width}%;`,
        }),
      },
      "data-fit": {
        default: "contain",
        parseHTML: (element) => element.getAttribute("data-fit") || "contain",
        renderHTML: (attributes) => ({ "data-fit": attributes["data-fit"] || "contain" }),
      },
      "data-align": {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") || "center",
        renderHTML: (attributes) => ({ "data-align": attributes["data-align"] || "center" }),
      },
    };
  },
});

const RichTable = TiptapTable.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      optionGroup: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-mcq-option-group") === "true",
        renderHTML: (attributes) => (attributes.optionGroup ? { "data-mcq-option-group": "true" } : {}),
      },
      optionLayout: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-layout"),
        renderHTML: (attributes) => (attributes.optionLayout ? { "data-option-layout": attributes.optionLayout } : {}),
      },
      optionBorders: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-borders"),
        renderHTML: (attributes) => (attributes.optionBorders === null || attributes.optionBorders === undefined ? {} : { "data-option-borders": String(attributes.optionBorders) }),
      },
      optionHeaders: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-headers"),
        renderHTML: (attributes) => (attributes.optionHeaders === null || attributes.optionHeaders === undefined ? {} : { "data-option-headers": String(attributes.optionHeaders) }),
      },
      letterPlacement: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-letter-placement"),
        renderHTML: (attributes) => (attributes.letterPlacement ? { "data-option-letter-placement": attributes.letterPlacement } : {}),
      },
      letterAlign: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-letter-align"),
        renderHTML: (attributes) => (attributes.letterAlign ? { "data-option-letter-align": attributes.letterAlign } : {}),
      },
      contentAlign: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-content-align"),
        renderHTML: (attributes) => (attributes.contentAlign ? { "data-option-content-align": attributes.contentAlign } : {}),
      },
      optionGap: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-gap"),
        renderHTML: (attributes) => (attributes.optionGap === null || attributes.optionGap === undefined ? {} : { "data-option-gap": String(attributes.optionGap) }),
      },
      cellPadding: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-option-cell-padding"),
        renderHTML: (attributes) => (attributes.cellPadding ? { "data-option-cell-padding": attributes.cellPadding } : {}),
      },
    };
  },
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    return [
      ...parentPlugins,
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "table") return true;
              const attrs = node.attrs ?? {};
              if (!attrs.optionGroup) return true;
              decorations.push(Decoration.node(pos, pos + node.nodeSize, {
                "data-mcq-option-group": "true",
                "data-option-layout": attrs.optionLayout || "",
                "data-option-borders": attrs.optionBorders === null || attrs.optionBorders === undefined ? "" : String(attrs.optionBorders),
                "data-option-headers": attrs.optionHeaders === null || attrs.optionHeaders === undefined ? "" : String(attrs.optionHeaders),
                "data-option-letter-placement": attrs.letterPlacement || "",
                "data-option-letter-align": attrs.letterAlign || "",
                "data-option-content-align": attrs.contentAlign || "",
                "data-option-gap": attrs.optionGap === null || attrs.optionGap === undefined ? "" : String(attrs.optionGap),
                "data-option-cell-padding": attrs.cellPadding || "",
                style: `--mcq-option-gap:${Number(attrs.optionGap) || 0}px`,
              }));
              return true;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function clipboardImageFile(event: { clipboardData: DataTransfer | null }): File | null {
  if (!event.clipboardData) return null;
  const item = Array.from(event.clipboardData.items).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (!file) return null;
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "png";
  return new File([file], `clipboard-image-${Date.now()}.${extension}`, { type: file.type || "image/png" });
}

function sourceQuestionDigits(value: string) {
  return value.trim().replace(/^q[-\s]?/i, "");
}

function normalizeSourceQuestion(value: string) {
  const digits = sourceQuestionDigits(value);
  return digits ? `Q${digits}` : "";
}

function textToRichDoc(text: string): JSONContent {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (!paragraphs.length) return defaultRichContent;
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    })),
  };
}

function richDocToText(doc: JSONContent): string {
  const lines: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "text" && node.text) {
      lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""}${node.text}`;
      return;
    }
    if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") {
      lines.push("");
      node.content?.forEach(walk);
      return;
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return lines.map((line) => line.trim()).filter(Boolean).join("\n\n");
}

function richNodeText(node?: JSONContent): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(richNodeText).join(" ").replace(/\s+/g, " ").trim();
}

function optionLabelFromText(value: string) {
  const match = value.trim().match(/^([A-Z])(?:[.)\s]|$)/);
  return match?.[1] ?? "";
}

function extractOptionsFromRichContent(content: JSONContent): ExtractedOption[] {
  const found = new Map<string, string>();
  let hasOptionGroup = false;
  const capture = (label: string, text: string) => {
    if (!label || !/^[A-Z]$/.test(label)) return;
    const clean = text.replace(new RegExp(`^${label}[.)\\s]*`), "").trim();
    found.set(label, clean);
  };
  const scanForOptionGroup = (node?: JSONContent): boolean => {
    if (!node) return false;
    if (node.type === "table" && node.attrs?.optionGroup) return true;
    return Boolean(node.content?.some(scanForOptionGroup));
  };
  hasOptionGroup = scanForOptionGroup(content);
  const walk = (node?: JSONContent, insideOptionGroup = false) => {
    if (!node) return;
    const isOptionGroup = insideOptionGroup || (node.type === "table" && Boolean(node.attrs?.optionGroup));
    if (!hasOptionGroup && node.type === "paragraph") {
      const text = richNodeText(node);
      const label = optionLabelFromText(text);
      if (label) capture(label, text);
    }
    if (node.type === "tableRow" && (!hasOptionGroup || isOptionGroup)) {
      const cells = node.content ?? [];
      for (let index = 0; index < cells.length; index += 1) {
        const text = richNodeText(cells[index]);
        const label = optionLabelFromText(text);
        if (label) {
          const nextCellText = richNodeText(cells[index + 1]);
          capture(label, nextCellText || text);
        }
      }
    }
    node.content?.forEach((child) => walk(child, isOptionGroup));
  };
  walk(content);
  return ["A", "B", "C", "D"].map((label) => ({ label, text: found.get(label) ?? "" }));
}

function paragraphNode(text = ""): JSONContent {
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
}

function tableCellNode(text = "", header = false): JSONContent {
  return { type: header ? "tableHeader" : "tableCell", content: [paragraphNode(text)] };
}

function tableCellContentNode(content: JSONContent[] | undefined, header = false): JSONContent {
  return { type: header ? "tableHeader" : "tableCell", content: content?.length ? content : [paragraphNode("")] };
}

function tableRowNode(cells: Array<string | { text: string; header?: boolean }>): JSONContent {
  return {
    type: "tableRow",
    content: cells.map((cell) => typeof cell === "string" ? tableCellNode(cell) : tableCellNode(cell.text, cell.header)),
  };
}

function nodeText(node?: JSONContent): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return node.content?.map(nodeText).join("") ?? "";
}

function optionContentMapFromRichContent(content: JSONContent): Map<string, JSONContent[]> {
  const optionContent = new Map<string, JSONContent[]>();
  const collectCellContent = (cells: JSONContent[], startIndex: number) => {
    const content: JSONContent[] = [];
    cells.slice(startIndex).forEach((cell, index) => {
      if (index > 0) content.push({ type: "paragraph" });
      content.push(...(cell.content ?? [paragraphNode("")]));
    });
    return content.length ? content : [paragraphNode("")];
  };
  const inspectTable = (table: JSONContent) => {
    table.content?.forEach((row) => {
      const cells = row.content ?? [];
      for (let index = 0; index < cells.length; index += 1) {
        const label = nodeText(cells[index]).trim().replace(".", "").toUpperCase();
        if (["A", "B", "C", "D"].includes(label)) {
          const nextLabelIndex = cells.findIndex((cell, cellIndex) => cellIndex > index && ["A", "B", "C", "D"].includes(nodeText(cell).trim().replace(".", "").toUpperCase()));
          const endIndex = nextLabelIndex > -1 ? nextLabelIndex : cells.length;
          optionContent.set(label, collectCellContent(cells.slice(0, endIndex), index + 1));
          if (nextLabelIndex > -1) index = nextLabelIndex - 1;
        }
      }
    });
  };
  const walk = (node: JSONContent) => {
    if (node.type === "table" && node.attrs?.optionGroup) {
      inspectTable(node);
      return;
    }
    node.content?.forEach(walk);
  };
  walk(content);
  return optionContent;
}

function optionLayoutContent(layout: string, preserved = new Map<string, JSONContent[]>(), existingAttrs: Record<string, unknown> = {}): JSONContent {
  const attrs = {
    ...existingAttrs,
    optionGroup: true,
    optionLayout: layout,
    optionBorders: layout === "table" ? existingAttrs.optionBorders ?? true : false,
    optionHeaders: layout === "table" ? existingAttrs.optionHeaders ?? true : false,
    letterPlacement: existingAttrs.letterPlacement ?? "inline",
    letterAlign: existingAttrs.letterAlign ?? "center",
    contentAlign: existingAttrs.contentAlign ?? "left",
    optionGap: existingAttrs.optionGap ?? 6,
    cellPadding: existingAttrs.cellPadding ?? "normal",
  };
  const labelCell = (label: string) => tableCellNode(label);
  const answerCell = (label: string) => tableCellContentNode(preserved.get(label));
  if (layout === "two_column") {
    return {
      type: "table",
      attrs,
      content: [
        { type: "tableRow", content: [labelCell("A"), answerCell("A"), labelCell("B"), answerCell("B")] },
        { type: "tableRow", content: [labelCell("C"), answerCell("C"), labelCell("D"), answerCell("D")] },
      ],
    };
  }
  if (layout === "four_column") {
    return {
      type: "table",
      attrs,
      content: [{ type: "tableRow", content: [labelCell("A"), answerCell("A"), labelCell("B"), answerCell("B"), labelCell("C"), answerCell("C"), labelCell("D"), answerCell("D")] }],
    };
  }
  if (layout === "table") {
    return {
      type: "table",
      attrs,
      content: [
        tableRowNode(["", { text: "heading 1", header: true }, { text: "heading 2", header: true }, { text: "heading 3", header: true }, { text: "heading 4", header: true }]),
        { type: "tableRow", content: [labelCell("A"), answerCell("A"), tableCellNode(""), tableCellNode(""), tableCellNode("")] },
        { type: "tableRow", content: [labelCell("B"), answerCell("B"), tableCellNode(""), tableCellNode(""), tableCellNode("")] },
        { type: "tableRow", content: [labelCell("C"), answerCell("C"), tableCellNode(""), tableCellNode(""), tableCellNode("")] },
        { type: "tableRow", content: [labelCell("D"), answerCell("D"), tableCellNode(""), tableCellNode(""), tableCellNode("")] },
      ],
    };
  }
  return {
    type: "table",
    attrs,
    content: [
      { type: "tableRow", content: [labelCell("A"), answerCell("A")] },
      { type: "tableRow", content: [labelCell("B"), answerCell("B")] },
      { type: "tableRow", content: [labelCell("C"), answerCell("C")] },
      { type: "tableRow", content: [labelCell("D"), answerCell("D")] },
    ],
  };
}

function contentWithEmbeddedOptions(content: JSONContent, options: MCQQuestionDetailPayload["options"], layout: string): JSONContent {
  if (!options.length) return content;
  const sorted = options.slice().sort((left, right) => left.order - right.order);
  const optionCellContent = (option?: MCQQuestionDetailPayload["options"][number]) => {
    const nodes: JSONContent[] = [];
    const text = option?.blocks.filter((block) => block.block_type !== "image").map((block) => block.text).filter(Boolean).join("\n") ?? "";
    nodes.push(paragraphNode(text));
    option?.blocks.filter((block) => block.block_type === "image" && block.asset?.preview_url).forEach((block) => {
      nodes.push({ type: "image", attrs: { src: `${API_BASE}${block.asset!.preview_url}`, alt: block.asset!.original_name, width: block.settings?.width ?? 100, "data-fit": block.settings?.fit ?? "contain", "data-align": block.settings?.align ?? "center" } });
    });
    return nodes;
  };
  const cell = (contentNodes: JSONContent[]) => ({ type: "tableCell", content: contentNodes.length ? contentNodes : [paragraphNode("")] });
  const labelCell = (label: string) => tableCellNode(label);
  const row = (items: JSONContent[]) => ({ type: "tableRow", content: items });
  const optionByLabel = Object.fromEntries(sorted.map((option) => [option.label, option]));
  const pair = (label: string) => [labelCell(label), cell(optionCellContent(optionByLabel[label] ?? sorted[0]))];
  const tableRows = layout === "two_column" || layout === "grid"
    ? [row([...pair("A"), ...pair("B")]), row([...pair("C"), ...pair("D")])]
    : layout === "four_column"
      ? [row([...pair("A"), ...pair("B"), ...pair("C"), ...pair("D")])]
      : sorted.map((option) => row([labelCell(option.label), cell(optionCellContent(option))]));
  const merged = [...(content.content ?? [])];
  merged.push(paragraphNode(""), { type: "table", content: tableRows });
  return { ...content, content: merged };
}

function OptionTextEditor({
  value,
  label,
  isCorrect,
  onChange,
  onPasteImage,
}: {
  value: string;
  label: string;
  isCorrect: boolean;
  onChange: (value: string) => void;
  onPasteImage: (file: File) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapUnderline,
      Placeholder.configure({ placeholder: `Type option ${label}. Use $\\frac{1}{2}mv^2$ for inline maths. Paste an image to attach it.` }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: textToRichDoc(value),
    editorProps: {
      handlePaste: (_view, event) => {
        const file = clipboardImageFile(event);
        if (!file) return false;
        event.preventDefault();
        onPasteImage(file);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(richDocToText(editor.getJSON())),
  });

  useEffect(() => {
    if (!editor) return;
    const current = richDocToText(editor.getJSON());
    if (current !== value) {
      editor.commands.setContent(textToRichDoc(value), { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className={`option-rich-editor ${isCorrect ? "correct" : ""}`}>
      <EditorContent editor={editor} />
    </div>
  );
}

export function MCQAddQuestionView({ questionId, onSaved }: { questionId?: number | null; onSaved: () => void }) {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [step, setStep] = useState<EditorStep>("question");
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
  const [tableCellAssets, setTableCellAssets] = useState<Record<string, Array<number | null>>>({});
  const [layoutPreset, setLayoutPreset] = useState("standard");
  const [optionLayout, setOptionLayout] = useState("single");
  const [optionImagePlacement, setOptionImagePlacement] = useState<OptionImagePlacement>("top");
  const [optionImageSizing, setOptionImageSizing] = useState<OptionImageSizing>("individual");
  const [optionLabelPlacement, setOptionLabelPlacement] = useState<OptionLabelPlacement>("inline");
  const [optionLabelAlign, setOptionLabelAlign] = useState<OptionLabelAlign>("center");
  const [optionContentAlign, setOptionContentAlign] = useState<OptionContentAlign>("left");
  const [tableShowBorders, setTableShowBorders] = useState(true);
  const [tableShowHeaders, setTableShowHeaders] = useState(true);
  const [subject, setSubject] = useState("Physics");
  const [syllabus, setSyllabus] = useState("9702");
  const [examCode, setExamCode] = useState("");
  const [paperCode, setPaperCode] = useState("");
  const [session, setSession] = useState("");
  const [year, setYear] = useState("");
  const [source, setSource] = useState("");
  const [sourceQuestionNumber, setSourceQuestionNumber] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [reviewStatus, setReviewStatus] = useState<MCQReviewStatus>("draft");
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [subtopicIds, setSubtopicIds] = useState<number[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [teacherNotes, setTeacherNotes] = useState("");
  const [newTopicName, setNewTopicName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [openMetadataPicker, setOpenMetadataPicker] = useState<"topics" | "tags" | null>(null);
  const [openControlDropdown, setOpenControlDropdown] = useState<"font" | "review" | null>(null);
  const [openEditorMenu, setOpenEditorMenu] = useState<"numbering" | "imageSize" | "imageFit" | null>(null);
  const [selectedImageWidth, setSelectedImageWidth] = useState<number | null>(null);
  const [selectedImageFit, setSelectedImageFit] = useState<"contain" | "cover" | null>(null);
  const [selectedImageAlign, setSelectedImageAlign] = useState<ImageAlign | null>(null);
  const [paperFontSizePt, setPaperFontSizePt] = useState(11);
  const [paperFontFamily, setPaperFontFamily] = useState("Calibri");
  const [equationScale, setEquationScale] = useState(1);
  const [optionGapPx, setOptionGapPx] = useState(6);
  const [bulkOptionImageWidth, setBulkOptionImageWidth] = useState(60);
  const [customImageWidth, setCustomImageWidth] = useState(60);
  const [pendingOptionLayout, setPendingOptionLayout] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [domTableContext, setDomTableContext] = useState<EditorTableContext>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const editorScaleRef = useRef<HTMLDivElement | null>(null);
  const previewScaleRef = useRef<HTMLDivElement | null>(null);
  const metadataPickerRef = useRef<HTMLDivElement | null>(null);
  const [editorScale, setEditorScale] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);
  const extractedOptions = useMemo(() => extractOptionsFromRichContent(richContent), [richContent]);

  const visibleSubtopics = useMemo(() => {
    const selectedTopics = metadata?.topics.filter((topic) => topicIds.includes(topic.id)) ?? [];
    return selectedTopics.flatMap((topic) => topic.subtopics.map((subtopic) => ({ ...subtopic, topicName: topic.name })));
  }, [metadata, topicIds]);

  useEffect(() => {
    const pageWidth = 794;
    const pageHeight = 1123;
    const observe = (element: HTMLDivElement | null, setter: Dispatch<SetStateAction<number>>, includeHeight = false) => {
      if (!element) return undefined;
      const resize = () => {
        const widthScale = Math.max(Math.min((element.clientWidth - 28) / pageWidth, 1), 0.32);
        const heightScale = includeHeight ? Math.max(Math.min((element.clientHeight - 28) / pageHeight, 1), 0.32) : 1;
        const nextScale = Math.round(Math.min(widthScale, heightScale) * 1000) / 1000;
        setter((current) => (Math.abs(current - nextScale) < 0.004 ? current : nextScale));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      return () => observer.disconnect();
    };
    const cleanupEditor = observe(editorScaleRef.current, setEditorScale);
    const cleanupPreview = observe(previewScaleRef.current, setPreviewScale);
    return () => {
      cleanupEditor?.();
      cleanupPreview?.();
    };
  }, [step]);

  useEffect(() => {
    function closeMetadataPicker(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".teacherdesk-select")) return;
      if (target instanceof Node && metadataPickerRef.current?.contains(target)) return;
      setOpenMetadataPicker(null);
      setOpenControlDropdown(null);
    }

    function closeMetadataPickerOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMetadataPicker(null);
        setOpenControlDropdown(null);
      }
    }

    document.addEventListener("pointerdown", closeMetadataPicker, true);
    document.addEventListener("keydown", closeMetadataPickerOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMetadataPicker, true);
      document.removeEventListener("keydown", closeMetadataPickerOnEscape);
    };
  }, []);

  useEffect(() => {
    setOpenMetadataPicker(null);
    setOpenControlDropdown(null);
    setOpenEditorMenu(null);
  }, [step]);

  useEffect(() => {
    applyOptionGroupStateFromSelection();
  }, [selectionRevision]);

  const richEditor = useEditor({
    extensions: [
      StarterKit,
      TiptapUnderline,
      Placeholder.configure({
        placeholder: "Write the question here. Use $v = u + at$ for inline equations, or insert images and tables from the toolbar.",
      }),
      RichImage.configure({ allowBase64: false, inline: false }),
      RichTable.configure({ resizable: true }),
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
      handlePaste: (_view, event) => {
        const file = clipboardImageFile(event);
        if (!file) return false;
        event.preventDefault();
        void uploadEditorImage(file);
        return true;
      },
      handleClickOn: (view, pos, node) => {
        if (node.type.name !== "image") return false;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setRichContent(editor.getJSON());
      setRichHtml(editor.getHTML());
      setRichText(editor.getText({ blockSeparator: "\n" }));
    },
    onSelectionUpdate: ({ editor }) => {
      refreshSelectedImageState(editor);
      setSelectionRevision((value) => value + 1);
    },
    onFocus: ({ editor }) => {
      refreshSelectedImageState(editor);
      setSelectionRevision((value) => value + 1);
    },
  });

  useEffect(() => {
    const handleEditorEvent = (event: Event) => {
      const stage = editorScaleRef.current;
      const target = event.target;
      if (!(target instanceof Node) || !stage?.contains(target)) return;
      updateDomTableContext(target);
    };
    document.addEventListener("mousedown", handleEditorEvent, true);
    document.addEventListener("click", handleEditorEvent, true);
    document.addEventListener("keyup", handleEditorEvent, true);
    return () => {
      document.removeEventListener("mousedown", handleEditorEvent, true);
      document.removeEventListener("click", handleEditorEvent, true);
      document.removeEventListener("keyup", handleEditorEvent, true);
    };
  }, [richEditor]);

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

  function syncRichEditorState() {
    if (!richEditor) return;
    setRichContent(richEditor.getJSON());
    setRichHtml(richEditor.getHTML());
    setRichText(richEditor.getText({ blockSeparator: "\n" }));
    setSelectionRevision((value) => value + 1);
  }

  function richContentHasOptionGroup(content = richContent) {
    const walk = (node?: JSONContent): boolean => {
      if (!node) return false;
      if (node.type === "table" && node.attrs?.optionGroup) return true;
      return Boolean(node.content?.some(walk));
    };
    return walk(content);
  }

  function replaceFirstOptionGroup(content: JSONContent, replacement: JSONContent): JSONContent {
    let replaced = false;
    const walk = (node: JSONContent): JSONContent => {
      if (!replaced && node.type === "table" && node.attrs?.optionGroup) {
        replaced = true;
        return replacement;
      }
      return node.content ? { ...node, content: node.content.map(walk) } : node;
    };
    return walk(content);
  }

  function selectedTableAttrsFromSelection() {
    if (!richEditor) return {};
    const { $from } = richEditor.state.selection;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "table") {
        return node.attrs ?? {};
      }
    }
    return {};
  }

  function currentTableAttrs() {
    return selectedTableAttrsFromSelection();
  }

  function selectionIsInsideTable() {
    return Boolean(Object.keys(selectedTableAttrsFromSelection()).length);
  }

  function tableContextFromElement(element: Element | null): EditorTableContext {
    const tableElement = element?.closest?.(".tableWrapper[data-mcq-option-group], table[data-mcq-option-group]") as HTMLElement | null
      ?? element?.closest?.(".tableWrapper, table") as HTMLElement | null;
    if (!tableElement) return {};
    const dataset = tableElement.dataset;
    return {
      optionGroup: dataset.mcqOptionGroup === "true",
      optionLayout: dataset.optionLayout || null,
      optionBorders: dataset.optionBorders || null,
      optionHeaders: dataset.optionHeaders || null,
      letterPlacement: dataset.optionLetterPlacement || null,
      letterAlign: dataset.optionLetterAlign || null,
      contentAlign: dataset.optionContentAlign || null,
      optionGap: dataset.optionGap || null,
      cellPadding: dataset.optionCellPadding || null,
    };
  }

  function updateDomTableContext(target?: EventTarget | null) {
    const targetElement = target instanceof Element ? target : null;
    const selectionNode = window.getSelection()?.anchorNode ?? null;
    const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement ?? null;
    const targetContext = tableContextFromElement(targetElement);
    const context = Object.keys(targetContext).length ? targetContext : tableContextFromElement(selectionElement);
    setDomTableContext(context);
    setSelectionRevision((value) => value + 1);
  }

  function updateSelectedTableAttrs(attrs: Record<string, unknown>) {
    richEditor?.chain().focus().updateAttributes("table", attrs).run();
    syncRichEditorState();
  }

  function runTableCommand(command: string) {
    const chain = richEditor?.chain().focus() as unknown as Record<string, () => { run: () => void }>;
    chain?.[command]?.().run();
    syncRichEditorState();
  }

  function refreshSelectedImageState(editor = richEditor) {
    if (!editor?.isActive("image")) {
      setSelectedImageWidth(null);
      setSelectedImageFit(null);
      setSelectedImageAlign(null);
      return;
    }
    const attrs = editor.getAttributes("image");
    const width = Number(attrs.width ?? 100);
    setSelectedImageWidth(Number.isFinite(width) ? width : 100);
    setSelectedImageFit(attrs["data-fit"] === "cover" ? "cover" : "contain");
    setSelectedImageAlign(attrs["data-align"] === "left" || attrs["data-align"] === "right" ? attrs["data-align"] : "center");
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
    const loadedRichContent = question.layout_settings?.rich_content || blocksToRichContent(nextBlocks);
    setRichEditorContent(question.layout_settings?.options_embedded ? loadedRichContent : contentWithEmbeddedOptions(loadedRichContent, question.options, question.option_layout || "single"));
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
              const legacyEquation = equationBlock?.text ? `$${equationBlock.text.replace(/^\${1,2}|\${1,2}$/g, "")}$` : "";
              return {
                label: option.label,
                text: [textBlock?.text ?? "", legacyEquation].filter(Boolean).join(textBlock?.text && legacyEquation ? "\n" : ""),
                assetId: imageBlock?.asset_id ?? null,
                imageWidth: imageBlock?.settings?.width ?? 100,
                imageHeight: imageBlock?.settings?.height ?? 0,
                imageFit: imageBlock?.settings?.fit ?? "contain",
                imageAlign: imageBlock?.settings?.align ?? "center",
                imageOffsetX: imageBlock?.settings?.offset_x ?? 0,
                imageOffsetY: imageBlock?.settings?.offset_y ?? 0,
              };
            })
        : defaultOptions,
    );
    const tableOptions = question.options.filter((option) => option.layout_settings?.table_cells?.length);
    if (tableOptions.length) {
      setTableHeaders(tableOptions[0].layout_settings.table_headers?.length ? tableOptions[0].layout_settings.table_headers! : defaultTableHeaders);
      setTableRows(Object.fromEntries(tableOptions.map((option) => [option.label, option.layout_settings.table_cells ?? []])));
      setTableCellAssets(Object.fromEntries(tableOptions.map((option) => [option.label, option.layout_settings.table_cell_asset_ids ?? []])));
    } else {
      setTableHeaders(defaultTableHeaders);
      setTableRows(defaultTableRows);
      setTableCellAssets({});
    }
    setLayoutPreset(question.layout_preset || "standard");
    setOptionLayout(question.option_layout || "single");
    const optionImageLayoutSettings = question.layout_settings?.option_image_layout;
    setOptionImagePlacement(
      ["top", "middle", "bottom"].includes(String(optionImageLayoutSettings?.placement))
        ? optionImageLayoutSettings?.placement as OptionImagePlacement
        : "top",
    );
    setOptionImageSizing(
      ["same_height", "same_width", "same_size"].includes(String(optionImageLayoutSettings?.sizing))
        ? optionImageLayoutSettings?.sizing as OptionImageSizing
        : "individual",
    );
    setOptionLabelPlacement(
      ["inline", "above", "below"].includes(String(optionImageLayoutSettings?.label_placement))
        ? optionImageLayoutSettings?.label_placement as OptionLabelPlacement
        : "inline",
    );
    setOptionLabelAlign(
      ["left", "center", "right"].includes(String(optionImageLayoutSettings?.label_align))
        ? optionImageLayoutSettings?.label_align as OptionLabelAlign
        : "center",
    );
    setOptionContentAlign(
      ["left", "center", "right"].includes(String(optionImageLayoutSettings?.content_align))
        ? optionImageLayoutSettings?.content_align as OptionContentAlign
        : "left",
    );
    setTableShowBorders(optionImageLayoutSettings?.table_borders !== false);
    setTableShowHeaders(optionImageLayoutSettings?.table_headers !== false);
    const paperStyleSettings = question.layout_settings?.paper_style;
    setPaperFontSizePt(Number(paperStyleSettings?.font_size_pt ?? 11));
    setPaperFontFamily(String(paperStyleSettings?.font_family || "Calibri"));
    setEquationScale(Number(paperStyleSettings?.equation_scale ?? 1));
    setOptionGapPx(Number(paperStyleSettings?.option_gap_px ?? 6));
    setSubject(question.subject || "Physics");
    setSyllabus(question.syllabus || "9702");
    setExamCode(question.exam_code || "");
    setPaperCode(question.paper_code || "");
    setSession(question.session || "");
    setYear(question.year ? String(question.year) : "");
    setSource(question.source || "");
    setSourceQuestionNumber(sourceQuestionDigits(question.source_question_number || ""));
    setDifficulty(question.difficulty || "Medium");
    setReviewStatus(question.review_status || "draft");
    setTopicIds(question.topics.map((topic) => topic.id));
    setSubtopicIds(question.subtopics.map((subtopic) => subtopic.id));
    setTagIds(question.tags.map((tag) => tag.id));
    setNotes(question.notes || "");
    setTeacherNotes(question.teacher_notes || "");
    setStep("question");
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
    setDifficulty(defaults.difficulty || "Medium");
    setReviewStatus(defaults.reviewStatus || "draft");
    setTopicIds([]);
    setSubtopicIds([]);
    setTagIds([]);
  }

  function rememberMetadataDefaults() {
    const defaults: LastMetadataDefaults = { subject, syllabus, examCode, paperCode, session, year, source, difficulty, reviewStatus, topicIds: [], subtopicIds: [], tagIds: [] };
    localStorage.setItem(metadataDefaultsKey, JSON.stringify(defaults));
  }

  function blockHasContent(block: ContentBlockDraft) {
    return Boolean(block.text.trim() || block.assetId || tableRowsFromText(block.tableText).length);
  }

  function buildAutomaticTitle() {
    const sourceLabel = [examCode, normalizeSourceQuestion(sourceQuestionNumber)].filter(Boolean).join(" ");
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

  function insertIntoOptionText(index: number, snippet: string) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? { ...option, text: `${option.text}${option.text ? " " : ""}$${snippet}$` } : option)));
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

  function updateAllOptionImages(patch: Partial<OptionDraft>) {
    setOptions((current) => current.map((option) => (option.assetId ? { ...option, ...patch } : option)));
  }

  function addOption() {
    const nextLabel = String.fromCharCode(65 + options.length);
    setOptions((current) => [...current, createDefaultOption(nextLabel)]);
    setTableRows((current) => ({ ...current, [nextLabel]: Array.from({ length: tableHeaders.length }, () => "") }));
    setTableCellAssets((current) => ({ ...current, [nextLabel]: Array.from({ length: tableHeaders.length }, () => null) }));
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    const removedLabel = options[index].label;
    const nextOptions = options.filter((_, optionIndex) => optionIndex !== index);
    setOptions(nextOptions);
    setTableRows((current) => Object.fromEntries(Object.entries(current).filter(([label]) => label !== removedLabel)));
    setTableCellAssets((current) => Object.fromEntries(Object.entries(current).filter(([label]) => label !== removedLabel)));
    if (correctOption === removedLabel) setCorrectOption(nextOptions[0]?.label ?? "A");
  }

  function updateTableHeader(index: number, value: string) {
    setTableHeaders((current) => current.map((header, headerIndex) => (headerIndex === index ? value : header)));
  }

  function addTableColumn() {
    setTableHeaders((current) => [...current, `column ${current.length + 1}`]);
    setTableRows((current) => Object.fromEntries(options.map((option) => [option.label, [...(current[option.label] ?? []), ""]])));
    setTableCellAssets((current) => Object.fromEntries(options.map((option) => [option.label, [...(current[option.label] ?? []), null]])));
  }

  function removeTableColumn(index: number) {
    if (tableHeaders.length <= 1) return;
    setTableHeaders((current) => current.filter((_, headerIndex) => headerIndex !== index));
    setTableRows((current) => Object.fromEntries(options.map((option) => [option.label, (current[option.label] ?? []).filter((_, cellIndex) => cellIndex !== index)])));
    setTableCellAssets((current) => Object.fromEntries(options.map((option) => [option.label, (current[option.label] ?? []).filter((_, cellIndex) => cellIndex !== index)])));
  }

  function updateTableCell(label: string, columnIndex: number, value: string) {
    setTableRows((current) => {
      const row = [...(current[label] ?? Array.from({ length: tableHeaders.length }, () => ""))];
      row[columnIndex] = value;
      return { ...current, [label]: row };
    });
  }

  function updateTableCellAsset(label: string, columnIndex: number, assetId: number | null) {
    setTableCellAssets((current) => {
      const row = [...(current[label] ?? Array.from({ length: tableHeaders.length }, () => null))];
      row[columnIndex] = assetId;
      return { ...current, [label]: row };
    });
  }

  function toggleNumberValue(value: number, selected: number[], setter: (values: number[]) => void) {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  function applyExamCodeDefaults() {
    const normalized = examCode.trim();
    const match = normalized.match(/^(\d{4})_([smw])(\d{2})_(?:qp|ms)_(\d{2})$/i);
    if (!match) return;
    const [, syllabusCode, sessionCode, yearCode, component] = match;
    const sessionMap: Record<string, string> = { s: "May/June", w: "Oct/Nov", m: "Feb/March" };
    setSyllabus(syllabusCode);
    setSubject(syllabusCode === "9702" ? "Physics" : subject || "");
    setSession(sessionMap[sessionCode.toLowerCase()] ?? session);
    setYear(`20${yearCode}`);
    setPaperCode(`Paper ${component.charAt(0)}`);
    setSource("Cambridge");
  }

  const difficultyOptions = useMemo(() => {
    const base = ["Easy", "Medium", "Hard"];
    const extras = metadata?.difficulties ?? [];
    return Array.from(new Set([...base, ...extras.filter(Boolean)]));
  }, [metadata]);

  function metadataMatches(items: Array<{ id: number; name: string }>, query: string) {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  }

  async function saveQuickTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    const existing = metadata?.topics.find((topic) => topic.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setTopicIds((current) => (current.includes(existing.id) ? current : [...current, existing.id]));
      setNewTopicName("");
      setOpenMetadataPicker(null);
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/topics/save/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, is_active: true }),
      });
      const topic = await readJson<MCQMetadataPayload["topics"][number]>(response);
      setMetadata((current) => current ? { ...current, topics: [...current.topics.filter((item) => item.id !== topic.id), topic].sort((a, b) => a.name.localeCompare(b.name)) } : current);
      setTopicIds((current) => (current.includes(topic.id) ? current : [...current, topic.id]));
      setNewTopicName("");
      setOpenMetadataPicker(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save topic.");
    }
  }

  async function saveQuickTag() {
    const name = newTagName.trim();
    if (!name) return;
    const existing = metadata?.tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setTagIds((current) => (current.includes(existing.id) ? current : [...current, existing.id]));
      setNewTagName("");
      setOpenMetadataPicker(null);
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/tags/save/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const tag = await readJson<MCQMetadataPayload["tags"][number]>(response);
      setMetadata((current) => current ? { ...current, tags: [...current.tags.filter((item) => item.id !== tag.id), tag].sort((a, b) => a.name.localeCompare(b.name)) } : current);
      setTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
      setNewTagName("");
      setOpenMetadataPicker(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save tag.");
    }
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
      cell_asset_ids: Object.fromEntries(options.map((option) => [
        option.label,
        tableHeaders.map((_, index) => tableCellAssets[option.label]?.[index] ?? null),
      ])),
    };
  }

  function optionPayloadBlocks() {
    return Object.fromEntries(extractedOptions.map((option) => [
      option.label,
      [
        option.text.trim() ? { block_type: "text", text: option.text, order: 1 } : { block_type: "text", text: `Option ${option.label}`, order: 1 },
      ].filter(Boolean),
    ]));
  }

  function optionHasContent(option: OptionDraft) {
    if (option.text.trim() || option.assetId) return true;
    if (optionLayout !== "table") return false;
    return (tableRows[option.label] ?? []).some((cell) => cell.trim());
  }

  function buildQuestionPayload(overwriteDuplicate = false) {
    const normalizedSourceQuestion = normalizeSourceQuestion(sourceQuestionNumber);
    const structuredOptions = extractedOptions.length ? extractedOptions : defaultOptions.map((option) => ({ label: option.label, text: option.text }));
    return {
      title: buildAutomaticTitle(),
      question_blocks: questionPayloadBlocks(),
      correct_option: correctOption,
      marks,
      option_labels: structuredOptions.map((option) => option.label),
      option_texts: Object.fromEntries(structuredOptions.map((option) => [option.label, option.text])),
      option_asset_ids: {},
      option_blocks: optionPayloadBlocks(),
      option_table: {},
      duplicate_strategy: overwriteDuplicate ? "overwrite" : "cancel",
      layout_preset: layoutPreset,
      option_layout: optionLayout,
      layout_settings: {
        rich_content: richContent,
        rich_html: richHtml,
        rich_text: richText || richPlainText(),
        options_embedded: true,
        option_image_layout: {
          placement: optionImagePlacement,
          sizing: optionImageSizing,
          label_placement: optionLabelPlacement,
          label_align: optionLabelAlign,
          content_align: optionContentAlign,
          table_borders: tableShowBorders,
          table_headers: tableShowHeaders,
        },
        paper_style: {
          font_size_pt: paperFontSizePt,
          font_family: paperFontFamily,
          equation_scale: equationScale,
          option_gap_px: optionGapPx,
          question_number_weight: 700,
        },
      },
      subject,
      syllabus,
      exam_code: examCode,
      paper_code: paperCode,
      session,
      year,
      source,
      source_question_number: normalizedSourceQuestion,
      difficulty,
      review_status: reviewStatus,
      topic_ids: topicIds,
      subtopic_ids: subtopicIds,
      tag_ids: tagIds,
      notes,
      teacher_notes: teacherNotes,
    };
  }

  async function postQuestionPayload(overwriteDuplicate = false) {
    const response = await fetch(questionId ? `${API_BASE}/api/mcq/questions/${questionId}/update/` : `${API_BASE}/api/mcq/questions/create/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildQuestionPayload(overwriteDuplicate)),
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") && text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = payload?.error || (text.startsWith("<") ? `Request failed with HTTP ${response.status}. Backend returned an HTML error page.` : text);
      const duplicate = response.status === 409 && payload?.code === "duplicate_question";
      throw Object.assign(new Error(message), { duplicate, duplicatePayload: payload });
    }
    return payload as MCQQuestionDetailPayload & { overwritten?: boolean };
  }

  async function saveQuestion(stayOnPage = false) {
    setStatus(null);
    setError(null);
    if (!richContentHasContent() && !blocks.some(blockHasContent)) {
      setError("Add question content before saving. You can type, insert an equation, add an image, or add a table.");
      setStep("question");
      return;
    }
    const emptyOptions = extractedOptions.filter((option) => !option.text.trim()).map((option) => option.label);
    if (emptyOptions.length) {
      setError(`Add option labels and content for ${emptyOptions.join(", ")} inside the A4 editor before saving. Use the Insert option layout buttons if needed.`);
      setStep("question");
      return;
    }
    if (!extractedOptions.some((option) => option.label === correctOption && option.text.trim())) {
      setError("The correct answer cannot be empty.");
      setStep("question");
      return;
    }
    if (!extractedOptions.some((option) => option.label === correctOption)) {
      setError("Choose a valid correct option.");
      setStep("question");
      return;
    }
    const normalizedSourceQuestion = normalizeSourceQuestion(sourceQuestionNumber);
    if (!normalizedSourceQuestion && !confirm("Original question number is empty. This is useful when entering many questions from the same paper. Save anyway?")) {
      setStep("question");
      return;
    }
    setIsSaving(true);
    try {
      let savedQuestion = await postQuestionPayload(false);
      if (savedQuestion?.overwritten) setStatus("Existing question overwritten.");
      rememberMetadataDefaults();
      setStatus(savedQuestion?.overwritten ? "Existing question overwritten." : questionId ? "Question updated." : "Question saved.");
      if (stayOnPage) resetForm();
      else onSaved();
    } catch (caught) {
      if (caught instanceof Error && (caught as Error & { duplicate?: boolean }).duplicate) {
        const overwrite = confirm(`${caught.message}\n\nOverwrite the existing question with this version? Choose Cancel to keep the existing question unchanged.`);
        if (!overwrite) {
          setError("Save cancelled. The existing question was kept unchanged.");
          setStep("question");
          return;
        }
        try {
          const savedQuestion = await postQuestionPayload(true);
          rememberMetadataDefaults();
          setStatus(savedQuestion?.overwritten ? "Existing question overwritten." : "Question saved.");
          if (stayOnPage) resetForm();
          else onSaved();
        } catch (retryError) {
          setError(retryError instanceof Error ? retryError.message : "Could not overwrite the existing question.");
        }
        return;
      }
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
    setOptions(defaultOptions.map((option) => ({ ...option })));
    setTableHeaders([...defaultTableHeaders]);
    setTableRows(Object.fromEntries(Object.entries(defaultTableRows).map(([label, row]) => [label, [...row]])));
    setTableCellAssets({});
    setOptionImagePlacement("top");
    setOptionImageSizing("individual");
    setOptionLabelPlacement("inline");
    setOptionLabelAlign("center");
    setOptionContentAlign("left");
    setPaperFontSizePt(11);
    setPaperFontFamily("Calibri");
    setEquationScale(1);
    setOptionGapPx(6);
    setTableShowBorders(true);
    setTableShowHeaders(true);
    setStep("question");
    setSourceQuestionNumber("");
    setNotes("");
    setTeacherNotes("");
    setDifficulty("Medium");
    setNewTopicName("");
    setNewTagName("");
    setOpenMetadataPicker(null);
    if (!questionId) applyMetadataDefaults();
  }

  async function uploadAsset(file: File | null, assetType: "question" | "option" | "table_cell", onDone: (asset: MCQAsset) => void) {
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
    setSelectedImageWidth(width);
    setCustomImageWidth(width);
    if (richEditor) {
      setRichContent(richEditor.getJSON());
      setRichHtml(richEditor.getHTML());
    }
  }

  function setEditorImageFit(fit: "contain" | "cover") {
    richEditor?.chain().focus().updateAttributes("image", { "data-fit": fit }).run();
    setSelectedImageFit(fit);
    if (richEditor) {
      setRichContent(richEditor.getJSON());
      setRichHtml(richEditor.getHTML());
    }
  }

  function setEditorImageAlign(align: ImageAlign) {
    richEditor?.chain().focus().updateAttributes("image", { "data-align": align }).run();
    setSelectedImageAlign(align);
    if (richEditor) {
      setRichContent(richEditor.getJSON());
      setRichHtml(richEditor.getHTML());
    }
  }

  function applyNumbering(type: string) {
    richEditor?.chain().focus().toggleOrderedList().updateAttributes("orderedList", { type }).run();
    setOpenEditorMenu(null);
  }

  function insertOptionLayout(layout: string) {
    setOptionLayout(layout);
    setLayoutPreset(layout === "table" ? "table_options" : layout === "grid" ? "option_grid" : "standard");
    const optionContent = optionLayoutContent(layout);
    richEditor?.chain().focus().insertContent([
      paragraphNode(""),
      optionContent,
      paragraphNode(""),
    ]).run();
    syncRichEditorState();
  }

  function requestOptionLayout(layout: string) {
    if (richContentHasOptionGroup()) {
      setPendingOptionLayout(layout);
      return;
    }
    insertOptionLayout(layout);
  }

  function replaceOptionLayout(layout: string) {
    const currentContent = richEditor?.getJSON() ?? richContent;
    const preserved = optionContentMapFromRichContent(currentContent);
    const attrs = currentTableAttrs();
    setOptionLayout(layout);
    setLayoutPreset(layout === "table" ? "table_options" : "standard");
    setRichEditorContent(replaceFirstOptionGroup(currentContent, optionLayoutContent(layout, preserved, attrs)));
    setPendingOptionLayout(null);
  }

  function updateOptionGroupSetting(attrs: Record<string, unknown>) {
    const current = currentTableAttrs();
    if (current.optionGroup) {
      updateSelectedTableAttrs(attrs);
      return;
    }
    const currentContent = richEditor?.getJSON() ?? richContent;
    setRichEditorContent(replaceFirstOptionGroup(currentContent, optionLayoutContent(optionLayout, optionContentMapFromRichContent(currentContent), attrs)));
  }

  function applyOptionGroupStateFromSelection() {
    const attrs = currentTableAttrs();
    if (!attrs.optionGroup) return;
    if (typeof attrs.optionLayout === "string") setOptionLayout(attrs.optionLayout);
    if (typeof attrs.letterPlacement === "string") setOptionLabelPlacement(attrs.letterPlacement === "above" || attrs.letterPlacement === "below" ? attrs.letterPlacement : "inline");
    if (["left", "center", "right"].includes(String(attrs.letterAlign))) setOptionLabelAlign(attrs.letterAlign as OptionLabelAlign);
    if (["left", "center", "right"].includes(String(attrs.contentAlign))) setOptionContentAlign(attrs.contentAlign as OptionContentAlign);
    setTableShowBorders(attrs.optionBorders !== false && attrs.optionBorders !== "false");
    setTableShowHeaders(attrs.optionHeaders !== false && attrs.optionHeaders !== "false");
    if (attrs.optionGap !== null && attrs.optionGap !== undefined) setOptionGapPx(Number(attrs.optionGap) || 6);
  }

  async function uploadEditorImage(file: File | null) {
    await uploadAsset(file, "question", (asset) => {
      richEditor?.chain().focus().setImage({ src: `${API_BASE}${asset.preview_url}`, alt: asset.original_name, width: 100 }).updateAttributes("image", { "data-fit": "contain", "data-align": "center" }).run();
      refreshSelectedImageState();
    });
  }

  function handleOptionPaste(event: ReactClipboardEvent<HTMLTextAreaElement>, index: number) {
    const file = clipboardImageFile(event);
    if (!file) return;
    event.preventDefault();
    void uploadAsset(file, "option", (asset) => updateOption(index, { assetId: asset.id }));
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
    const textAlign = typeof node.attrs?.textAlign === "string" ? node.attrs.textAlign as CSSProperties["textAlign"] : undefined;
    if (node.type === "paragraph") return <p key={key} style={textAlign ? { textAlign } : undefined}>{children}</p>;
    if (node.type === "heading") {
      const level = Math.min(Number(node.attrs?.level || 2), 3);
      return level === 1 ? <h1 key={key} style={textAlign ? { textAlign } : undefined}>{children}</h1> : level === 2 ? <h2 key={key} style={textAlign ? { textAlign } : undefined}>{children}</h2> : <h3 key={key} style={textAlign ? { textAlign } : undefined}>{children}</h3>;
    }
    if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (node.type === "orderedList") {
      const listType = node.attrs?.type === "a" ? "lower-alpha" : node.attrs?.type === "A" ? "upper-alpha" : node.attrs?.type === "i" ? "lower-roman" : node.attrs?.type === "I" ? "upper-roman" : "decimal";
      return <ol key={key} style={{ listStyleType: listType }}>{children}</ol>;
    }
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "image") {
      const width = typeof node.attrs?.width === "number" ? `${node.attrs.width}%` : typeof node.attrs?.width === "string" ? node.attrs.width : "100%";
      const fit = node.attrs?.["data-fit"] === "cover" ? "cover" : "contain";
      const align = node.attrs?.["data-align"] === "left" || node.attrs?.["data-align"] === "right" ? node.attrs["data-align"] : "center";
      return <img className={`a4-question-image fit-${fit} align-${align}`} key={key} src={String(node.attrs?.src || "")} alt={String(node.attrs?.alt || "Question image")} style={{ width }} />;
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
    if (block.block_type === "table") {
      const rows = tableRowsFromText(block.tableText);
      return rows.length ? <table className="mcq-preview-table"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderMathText(cell)}</td>)}</tr>)}</tbody></table> : <p className="muted-preview">Table block</p>;
    }
    if (block.block_type === "note") return <p className="mcq-note-preview">{renderMathText(block.text || "Teacher note")}</p>;
    return <p>{block.text ? renderMathText(block.text) : "Question text block"}</p>;
  }

  function renderOption(option: OptionDraft) {
    const asset = assets.find((item) => item.id === option.assetId);
    const image = asset ? (
      <img
        className={`a4-option-image fit-${option.imageFit} align-${option.imageAlign}`}
        src={`${API_BASE}${asset.preview_url}`}
        alt={`${option.label} option`}
        style={{
          width: `${option.imageWidth}%`,
          height: option.imageHeight ? `${option.imageHeight}px` : undefined,
          transform: `translate(${option.imageOffsetX}px, ${option.imageOffsetY}px)`,
        }}
      />
    ) : null;
    const content = (
      <>
        {option.text ? <span className="option-text-fragment">{renderMathText(option.text)}</span> : null}
      </>
    );
    return (
      <>
        <b>{option.label}{optionLabelPlacement === "inline" ? "." : ""}</b>
        {optionImagePlacement === "top" ? image : null}
        {optionImagePlacement === "middle" && image ? <span className="option-media-middle">{image}<span>{content}</span></span> : content}
        {optionImagePlacement === "bottom" ? image : null}
        {!option.text && !asset ? <span className="option-text-fragment">Answer option</span> : null}
      </>
    );
  }

  function renderOptionTablePreview() {
    function renderCell(label: string, index: number) {
      const text = tableRows[label]?.[index] ?? "";
      const assetId = tableCellAssets[label]?.[index] ?? null;
      const asset = assets.find((item) => item.id === assetId);
      return (
        <span className="mcq-table-cell-content">
          {text ? <span>{renderMathText(text)}</span> : null}
          {asset ? <img src={`${API_BASE}${asset.preview_url}`} alt={asset.original_name} /> : null}
        </span>
      );
    }
    return (
      <table className={`mcq-answer-table-preview ${tableShowBorders ? "" : "no-borders"} ${tableShowHeaders ? "" : "hide-headers"}`}>
        {tableShowHeaders ? <thead>
          <tr>
            <th />
            {tableHeaders.map((header, index) => <th key={index}>{renderMathText(header)}</th>)}
          </tr>
        </thead> : null}
        <tbody>
          {options.map((option) => (
            <tr className={correctOption === option.label ? "correct" : ""} key={option.label}>
              <th>{option.label}</th>
              {tableHeaders.map((_, index) => <td key={index}>{renderCell(option.label, index)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function previewOptions(): MCQRenderOption[] {
    return options.map((option, index) => {
      const asset = assets.find((item) => item.id === option.assetId) ?? null;
      const tableCellAssetsForOption = tableHeaders.map((_, cellIndex) => {
        const assetId = tableCellAssets[option.label]?.[cellIndex] ?? null;
        return assets.find((item) => item.id === assetId) ?? null;
      });
      return {
        id: option.label,
        label: option.label,
        is_correct: correctOption === option.label,
        order: index + 1,
        content_text: option.text,
        layout_settings: optionLayout === "table" ? {
          table_headers: tableHeaders,
          table_cells: tableHeaders.map((_, cellIndex) => tableRows[option.label]?.[cellIndex] ?? ""),
          table_cell_assets: tableCellAssetsForOption,
        } : {},
        blocks: [
          option.text.trim() ? { id: `${option.label}-text`, block_type: "text", text: option.text, order: 1 } : null,
          asset ? {
            id: `${option.label}-image`,
            block_type: "image",
            asset,
            order: 2,
            settings: {
              width: option.imageWidth,
              height: option.imageHeight,
              fit: option.imageFit,
              align: option.imageAlign,
              offset_x: option.imageOffsetX,
              offset_y: option.imageOffsetY,
            },
          } : null,
        ].filter(Boolean) as MCQRenderOption["blocks"],
      };
    });
  }

  function selectedMetadataChips(items: Array<{ id: number; name: string }>, selectedIds: number[], setter: (values: number[]) => void) {
    const selected = items.filter((item) => selectedIds.includes(item.id));
    if (!selected.length) return <span className="empty-inline-note">Nothing selected for this question yet.</span>;
    return (
      <div className="selected-token-row">
        {selected.map((item) => (
          <button key={item.id} type="button" onClick={() => setter(selectedIds.filter((id) => id !== item.id))}>
            {item.name}<span>×</span>
          </button>
        ))}
      </div>
    );
  }

  function renderMetadataPicker(
    kind: "topics" | "tags",
    title: string,
    inputValue: string,
    setInputValue: (value: string) => void,
    items: Array<{ id: number; name: string }>,
    selectedIds: number[],
    setter: (values: number[]) => void,
    onCreate: () => Promise<void>,
    placeholder: string,
  ) {
    const matches = metadataMatches(items, inputValue);
    const isOpen = openMetadataPicker === kind;
    return (
      <div className="metadata-picker compact-combo">
        <strong>{title}</strong>
        {selectedMetadataChips(items, selectedIds, setter)}
        <div className="metadata-combo">
          <input
            value={inputValue}
            onFocus={() => setOpenMetadataPicker(kind)}
            onChange={(event) => {
              setInputValue(event.target.value);
              setOpenMetadataPicker(kind);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onCreate();
              }
              if (event.key === "Escape") setOpenMetadataPicker(null);
            }}
            placeholder={placeholder}
          />
          <button className="secondary-action" type="button" onClick={() => void onCreate()}><Plus size={15} />Add</button>
          {isOpen ? (
            <div className="metadata-combo-list" onPointerDown={(event) => event.stopPropagation()}>
              {matches.length ? matches.map((item) => (
                <button
                  className={selectedIds.includes(item.id) ? "active" : ""}
                  key={item.id}
                  type="button"
                  onClick={() => {
                    toggleNumberValue(item.id, selectedIds, setter);
                    setInputValue("");
                  }}
                >
                  <Check size={14} />{item.name}
                </button>
              )) : <span>No matching {title.toLowerCase()}. Press Enter or Add to create it.</span>}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const selectionTableAttrs = currentTableAttrs();
  const selectedTableAttrs = Object.keys(selectionTableAttrs).length ? { ...selectionTableAttrs, ...domTableContext } : domTableContext;
  const isInTable = selectionIsInsideTable() || Boolean(Object.keys(domTableContext).length);
  const isOptionGroup = Boolean(selectedTableAttrs.optionGroup);
  const ribbonMode: RibbonMode = selectedImageWidth && isOptionGroup
    ? "optionImage"
    : selectedImageWidth
      ? "image"
      : isOptionGroup && selectedTableAttrs.optionLayout === "table"
        ? "optionTable"
        : isOptionGroup
          ? "optionGroup"
          : isInTable
            ? "table"
            : "text";
  const ribbonTitle: Record<RibbonMode, string> = {
    text: "Text",
    image: "Question image",
    table: "Question table",
    optionGroup: "Answer options",
    optionTable: "Option table",
    optionImage: "Option image",
  };

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>{questionId ? "Edit MCQ Question" : "Add MCQ Question"}</h1>
          <span className="header-subtitle">Write on an A4 canvas, structure the answer options, then save a reusable MCQ.</span>
        </div>
        <button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(false)}><Save size={17} />Save question</button>
      </section>

      <section className="mcq-editor-grid">
        <div className="panel mcq-editor-panel refined">
          {status ? <div className="callout success">{status}</div> : null}
          {error ? <div className="callout error">{error}</div> : null}

          {step === "question" ? (
            <div className="mcq-step-panel">
              <div className="option-entry-grid compact-fields">
                <label className="field-stack"><span>Marks</span><input type="number" min={0} value={marks} onChange={(event) => setMarks(Number(event.target.value || 1))} /></label>
                <div className="field-stack review-status-control"><span>Review status</span><div className={`teacherdesk-select ${openControlDropdown === "review" ? "open" : ""}`}><button type="button" onClick={() => setOpenControlDropdown(openControlDropdown === "review" ? null : "review")}>{metadata?.review_statuses.find((item) => item.value === reviewStatus)?.label ?? reviewStatus}</button>{openControlDropdown === "review" ? <div className="teacherdesk-select-menu">{metadata?.review_statuses.map((item) => <button className={reviewStatus === item.value ? "active" : ""} key={item.value} type="button" onClick={() => { setReviewStatus(item.value as MCQReviewStatus); setOpenControlDropdown(null); }}>{item.label}</button>)}</div> : null}</div></div>
              </div>
              <div className="section-intro compact"><strong>Write the question on the A4 canvas</strong><span>Type normally, insert equations with LaTeX shortcuts, and add images or tables where they belong.</span></div>
              <div className="paper-style-panel">
                <div><strong>Paper style</strong><span>Saved with this question and mirrored in previews.</span></div>
                <div className="paper-font-selector"><span>Face</span><div className={`teacherdesk-select ${openControlDropdown === "font" ? "open" : ""}`}><button style={{ fontFamily: paperFontFamily }} type="button" onClick={() => setOpenControlDropdown(openControlDropdown === "font" ? null : "font")}>{paperFontFamily}</button>{openControlDropdown === "font" ? <div className="teacherdesk-select-menu">{paperFontOptions.map((font) => <button className={paperFontFamily === font ? "active" : ""} key={font} style={{ fontFamily: font }} type="button" onClick={() => { setPaperFontFamily(font); setOpenControlDropdown(null); }}>{font}</button>)}</div> : null}</div></div>
                <label className="paper-number-field"><span>Font</span><div><input type="number" min={8} max={18} step={0.5} value={paperFontSizePt} onChange={(event) => setPaperFontSizePt(Number(event.target.value || 11))} /><em>pt</em></div></label>
                <label className="paper-number-field"><span>Equation</span><div><input type="number" min={0.75} max={1.4} step={0.05} value={equationScale} onChange={(event) => setEquationScale(Number(event.target.value || 1))} /><em>x</em></div></label>
              </div>
              <div className="rich-editor-shell">
                <div className={`rich-editor-toolbar contextual-ribbon mode-${ribbonMode}`}>
                  <span className="ribbon-mode-chip">{ribbonTitle[ribbonMode]}</span>
                  {ribbonMode === "text" ? (
                    <>
                      <button className={richEditor?.isActive("bold") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleBold().run()} title="Bold"><Bold size={16} /></button>
                      <button className={richEditor?.isActive("italic") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleItalic().run()} title="Italic"><Italic size={16} /></button>
                      <button className={richEditor?.isActive("underline") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleUnderline().run()} title="Underline"><Underline size={16} /></button>
                      <button className={richEditor?.isActive("heading", { level: 2 }) ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading"><Heading2 size={16} /></button>
                      <button className={richEditor?.isActive("bulletList") ? "active" : ""} type="button" onClick={() => richEditor?.chain().focus().toggleBulletList().run()} title="Bullet list"><List size={16} /></button>
                      <div className="toolbar-menu-wrap">
                        <button className={richEditor?.isActive("orderedList") ? "active" : ""} type="button" onClick={() => setOpenEditorMenu(openEditorMenu === "numbering" ? null : "numbering")} title="Numbering style"><ListOrdered size={16} /></button>
                        {openEditorMenu === "numbering" ? <div className="toolbar-popover"><button type="button" onClick={() => applyNumbering("1")}>1, 2, 3</button><button type="button" onClick={() => applyNumbering("a")}>a, b, c</button><button type="button" onClick={() => applyNumbering("A")}>A, B, C</button><button type="button" onClick={() => applyNumbering("i")}>i, ii, iii</button><button type="button" onClick={() => applyNumbering("I")}>I, II, III</button></div> : null}
                      </div>
                      <button type="button" onClick={() => richEditor?.chain().focus().setTextAlign("left").run()} title="Align left"><AlignLeft size={16} /></button>
                      <button type="button" onClick={() => richEditor?.chain().focus().setTextAlign("center").run()} title="Align center"><AlignCenter size={16} /></button>
                      <button type="button" onClick={() => richEditor?.chain().focus().setTextAlign("right").run()} title="Align right"><AlignRight size={16} /></button>
                      <button type="button" onClick={() => richEditor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table"><Table2 size={16} /></button>
                      <label className="rich-upload-button" title="Insert image"><Image size={16} /><input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadEditorImage(event.target.files?.[0] ?? null)} /></label>
                    </>
                  ) : null}
                  {ribbonMode === "image" || ribbonMode === "optionImage" ? (
                    <>
                      <div className="image-size-control" title="Selected image width">
                        <span>Width</span>
                        {[5, 10, 25, 40, 50, 60, 75, 100].map((width) => <button className={selectedImageWidth === width ? "active" : ""} key={width} type="button" onClick={() => setEditorImageSize(width)}>{width}%</button>)}
                        <input aria-label="Custom image width" className="toolbar-small-input" type="number" min={5} max={180} value={customImageWidth} onChange={(event) => setCustomImageWidth(Number(event.target.value || 60))} />
                        <button type="button" onClick={() => setEditorImageSize(customImageWidth)}>%</button>
                      </div>
                      <button className={selectedImageAlign === "left" ? "active" : ""} type="button" onClick={() => setEditorImageAlign("left")} title="Align selected image left"><AlignLeft size={15} /></button>
                      <button className={selectedImageAlign === "center" ? "active" : ""} type="button" onClick={() => setEditorImageAlign("center")} title="Align selected image center"><AlignCenter size={15} /></button>
                      <button className={selectedImageAlign === "right" ? "active" : ""} type="button" onClick={() => setEditorImageAlign("right")} title="Align selected image right"><AlignRight size={15} /></button>
                      <button className={selectedImageFit === "contain" ? "active" : ""} type="button" onClick={() => setEditorImageFit("contain")}>Fit</button>
                      <button className={selectedImageFit === "cover" ? "active" : ""} type="button" onClick={() => setEditorImageFit("cover")}>Crop</button>
                      {ribbonMode === "optionImage" ? <button type="button" onClick={() => updateSelectedTableAttrs({ contentAlign: "center" })}>Apply to options</button> : null}
                    </>
                  ) : null}
                  {ribbonMode === "table" || ribbonMode === "optionTable" ? (
                    <>
                      <button type="button" onClick={() => runTableCommand("addRowBefore")}>Row above</button>
                      <button type="button" onClick={() => runTableCommand("addRowAfter")}>Row below</button>
                      <button type="button" onClick={() => runTableCommand("deleteRow")}>Delete row</button>
                      <button type="button" onClick={() => runTableCommand("addColumnBefore")}>Col left</button>
                      <button type="button" onClick={() => runTableCommand("addColumnAfter")}>Col right</button>
                      <button type="button" onClick={() => runTableCommand("deleteColumn")}>Delete col</button>
                      <button type="button" onClick={() => runTableCommand("mergeCells")}>Merge</button>
                      <button type="button" onClick={() => runTableCommand("splitCell")}>Split</button>
                      {ribbonMode === "optionTable" ? <button className={selectedTableAttrs.optionBorders !== false && selectedTableAttrs.optionBorders !== "false" ? "active" : ""} type="button" onClick={() => updateSelectedTableAttrs({ optionBorders: !(selectedTableAttrs.optionBorders !== false && selectedTableAttrs.optionBorders !== "false") })}>Borders</button> : null}
                    </>
                  ) : null}
                  <span className="ribbon-divider" />
                  <button type="button" onClick={() => richEditor?.chain().focus().undo().run()} title="Undo"><Undo2 size={16} /></button>
                  <button type="button" onClick={() => richEditor?.chain().focus().redo().run()} title="Redo"><Redo2 size={16} /></button>
                </div>
                {ribbonMode === "optionGroup" || ribbonMode === "optionTable" ? (
                  <div className="embedded-option-controls">
                    <div className="answer-control-row correct-row">
                      <strong>Correct answer</strong>
                      <div className="correct-answer-pill-group" aria-label="Correct answer">
                        {["A", "B", "C", "D"].map((label) => <button className={correctOption === label ? "active" : ""} key={label} type="button" onClick={() => setCorrectOption(label)}>{label}</button>)}
                      </div>
                    </div>
                    <div className="answer-control-row">
                      <strong>Option letters</strong>
                      <button className={optionLabelPlacement === "inline" ? "active" : ""} type="button" onClick={() => { setOptionLabelPlacement("inline"); updateSelectedTableAttrs({ letterPlacement: "inline" }); }} title="Letters beside option content">A.</button>
                      <button className={`letter-placement-icon above ${optionLabelPlacement === "above" ? "active" : ""}`} type="button" onClick={() => { setOptionLabelPlacement("above"); updateSelectedTableAttrs({ letterPlacement: "above" }); }} title="Letters above option content">A</button>
                      <button className={`letter-placement-icon below ${optionLabelPlacement === "below" ? "active" : ""}`} type="button" onClick={() => { setOptionLabelPlacement("below"); updateSelectedTableAttrs({ letterPlacement: "below" }); }} title="Letters below option content">A</button>
                      <span className="ribbon-divider" />
                      <button className={optionLabelAlign === "left" ? "active" : ""} type="button" onClick={() => { setOptionLabelAlign("left"); updateSelectedTableAttrs({ letterAlign: "left" }); }} title="Align letters left"><AlignLeft size={15} /></button>
                      <button className={optionLabelAlign === "center" ? "active" : ""} type="button" onClick={() => { setOptionLabelAlign("center"); updateSelectedTableAttrs({ letterAlign: "center" }); }} title="Center letters"><AlignCenter size={15} /></button>
                      <button className={optionLabelAlign === "right" ? "active" : ""} type="button" onClick={() => { setOptionLabelAlign("right"); updateSelectedTableAttrs({ letterAlign: "right" }); }} title="Align letters right"><AlignRight size={15} /></button>
                    </div>
                    <div className="answer-control-row">
                      <strong>Option content</strong>
                      <button className={optionContentAlign === "left" ? "active" : ""} type="button" onClick={() => { setOptionContentAlign("left"); updateSelectedTableAttrs({ contentAlign: "left" }); }} title="Align option content left"><AlignLeft size={15} /></button>
                      <button className={optionContentAlign === "center" ? "active" : ""} type="button" onClick={() => { setOptionContentAlign("center"); updateSelectedTableAttrs({ contentAlign: "center" }); }} title="Center option content"><AlignCenter size={15} /></button>
                      <button className={optionContentAlign === "right" ? "active" : ""} type="button" onClick={() => { setOptionContentAlign("right"); updateSelectedTableAttrs({ contentAlign: "right" }); }} title="Align option content right"><AlignRight size={15} /></button>
                      <label className="ribbon-range-label"><span>Indent</span><input type="range" min={0} max={24} value={optionGapPx} onChange={(event) => { const next = Number(event.target.value); setOptionGapPx(next); updateSelectedTableAttrs({ optionGap: next }); }} /><em>{optionGapPx}px</em></label>
                    </div>
                    {ribbonMode === "optionGroup" ? (
                      <div className="answer-control-row">
                        <strong>Columns</strong>
                        {optionLayoutVisuals.filter((item) => item.value !== "table").map((item) => (
                          <button className={optionLayout === item.value ? "active" : ""} key={item.value} type="button" onClick={() => requestOptionLayout(item.value)} title={item.subtitle}>{item.title}</button>
                        ))}
                      </div>
                    ) : null}
                    {ribbonMode === "optionTable" ? (
                      <div className="answer-control-row">
                        <strong>Table style</strong>
                        <button className={selectedTableAttrs.optionBorders !== false && selectedTableAttrs.optionBorders !== "false" ? "active" : ""} type="button" onClick={() => updateSelectedTableAttrs({ optionBorders: !(selectedTableAttrs.optionBorders !== false && selectedTableAttrs.optionBorders !== "false") })}>Borders</button>
                        <button className={selectedTableAttrs.optionHeaders !== false && selectedTableAttrs.optionHeaders !== "false" ? "active" : ""} type="button" onClick={() => updateSelectedTableAttrs({ optionHeaders: !(selectedTableAttrs.optionHeaders !== false && selectedTableAttrs.optionHeaders !== "false") })}>Headers</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="insert-options-ribbon">
                  <strong>Answer layout</strong>
                  {answerLayoutModes.map((item) => (
                    <button className={(item.value === "table" ? optionLayout === "table" : optionLayout !== "table") ? "active" : ""} key={item.value} onClick={() => requestOptionLayout(item.value === "table" ? "table" : (optionLayout === "table" ? "four_column" : optionLayout))} title={item.subtitle} type="button">
                      <span className={`option-layout-thumbnail ${item.value === "table" ? "table" : "four-column"}`}><i /><i /><i /><i /></span>
                      <span><b>{item.title}</b><small>{item.subtitle}</small></span>
                    </button>
                  ))}
                </div>
                {pendingOptionLayout ? (
                  <div className="option-layout-choice-panel">
                    <div>
                      <strong>Option area already exists</strong>
                      <span>Replace the layout and keep A-D content, or insert a second option group.</span>
                    </div>
                    <div className="option-layout-choice-actions">
                      <button className="primary-action" type="button" onClick={() => replaceOptionLayout(pendingOptionLayout)}>Replace layout</button>
                      <button className="secondary-action" type="button" onClick={() => { insertOptionLayout(pendingOptionLayout); setPendingOptionLayout(null); }}>Insert another</button>
                      <button className="secondary-action" type="button" onClick={() => setPendingOptionLayout(null)}>Cancel</button>
                    </div>
                  </div>
                ) : null}
                <div className="a4-editor-stage" ref={editorScaleRef} onClick={(event) => updateDomTableContext(event.target)} onKeyUp={(event) => updateDomTableContext(event.target)}>
                  <div className="a4-scale-shell" style={{ "--a4-scale": editorScale } as CSSProperties}>
                    <div className="a4-editor-page">
                      <EditorContent editor={richEditor} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {false ? (
            <div className="mcq-step-panel answer-editor-panel">
              <div className="section-intro compact"><strong>Answer choice arrangement</strong><span>Choose how A-D will be arranged on the generated paper.</span></div>
              <div className="option-layout-card-grid compact-option-layouts">{optionLayoutVisuals.map((item) => <button className={`option-layout-card ${optionLayout === item.value ? "active" : ""}`} key={item.value} onClick={() => { setOptionLayout(item.value); setLayoutPreset(item.value === "table" ? "table_options" : item.value === "grid" ? "option_grid" : "standard"); }} type="button"><span className={`option-layout-thumbnail ${item.className}`}><i /><i /><i /><i /></span><strong>{item.title}</strong><small>{item.subtitle}</small></button>)}</div>
              {optionLayout !== "table" ? (
                <div className="option-control-panel">
                  <div className="option-control-grid">
                    <div className="option-control-group">
                      <strong>Letters</strong>
                      <span>Placement and alignment of A-D only.</span>
                      <div className="option-image-toolbar compact" aria-label="Option letter controls">
                        <button className={optionLabelPlacement === "inline" ? "active" : ""} type="button" onClick={() => setOptionLabelPlacement("inline")} title="Letters beside answers" aria-label="Letters beside answers">A.</button>
                        <button className={optionLabelPlacement === "above" ? "active" : ""} type="button" onClick={() => setOptionLabelPlacement("above")} title="Letters above answers" aria-label="Letters above answers">A</button>
                        <span className="option-image-toolbar-divider" aria-hidden="true" />
                        <button className={optionLabelAlign === "left" ? "active" : ""} type="button" onClick={() => setOptionLabelAlign("left")} title="Align letters left" aria-label="Align letters left"><AlignLeft size={16} /></button>
                        <button className={optionLabelAlign === "center" ? "active" : ""} type="button" onClick={() => setOptionLabelAlign("center")} title="Center letters" aria-label="Center letters"><AlignCenter size={16} /></button>
                        <button className={optionLabelAlign === "right" ? "active" : ""} type="button" onClick={() => setOptionLabelAlign("right")} title="Align letters right" aria-label="Align letters right"><AlignRight size={16} /></button>
                      </div>
                    </div>
                    <div className="option-control-group">
                      <strong>Answer content</strong>
                      <span>Align text and images inside each option.</span>
                      <div className="option-image-toolbar compact" aria-label="Option content controls">
                        <button className={optionContentAlign === "left" ? "active" : ""} type="button" onClick={() => setOptionContentAlign("left")} title="Align content left" aria-label="Align content left"><AlignLeft size={16} /></button>
                        <button className={optionContentAlign === "center" ? "active" : ""} type="button" onClick={() => setOptionContentAlign("center")} title="Center content" aria-label="Center content"><AlignCenter size={16} /></button>
                        <button className={optionContentAlign === "right" ? "active" : ""} type="button" onClick={() => setOptionContentAlign("right")} title="Align content right" aria-label="Align content right"><AlignRight size={16} /></button>
                      </div>
                    </div>
                    <div className="option-control-group">
                      <strong>Image position</strong>
                      <span>Where image blocks sit relative to option text.</span>
                      <div className="option-image-toolbar compact" aria-label="Option image placement controls">
                        <button className={optionImagePlacement === "top" ? "active" : ""} type="button" onClick={() => setOptionImagePlacement("top")} title="Images above text" aria-label="Images above text"><AlignVerticalJustifyStart size={16} /></button>
                        <button className={optionImagePlacement === "middle" ? "active" : ""} type="button" onClick={() => setOptionImagePlacement("middle")} title="Images beside text" aria-label="Images beside text"><AlignVerticalJustifyCenter size={16} /></button>
                        <button className={optionImagePlacement === "bottom" ? "active" : ""} type="button" onClick={() => setOptionImagePlacement("bottom")} title="Images below text" aria-label="Images below text"><AlignVerticalJustifyEnd size={16} /></button>
                      </div>
                    </div>
                    <div className="option-control-group">
                      <strong>Image sizing</strong>
                      <span>Keep individual sizes or normalise option images.</span>
                      <div className="option-image-toolbar compact" aria-label="Option image sizing controls">
                        <button className={optionImageSizing === "individual" ? "active" : ""} type="button" onClick={() => setOptionImageSizing("individual")} title="Individual image sizes" aria-label="Individual image sizes"><Image size={16} /></button>
                        <button className={optionImageSizing === "same_height" ? "active" : ""} type="button" onClick={() => setOptionImageSizing("same_height")} title="Same image height" aria-label="Same image height"><StretchVertical size={16} /></button>
                        <button className={optionImageSizing === "same_width" ? "active" : ""} type="button" onClick={() => setOptionImageSizing("same_width")} title="Same image width" aria-label="Same image width"><StretchHorizontal size={16} /></button>
                        <button className={optionImageSizing === "same_size" ? "active" : ""} type="button" onClick={() => setOptionImageSizing("same_size")} title="Similar image size" aria-label="Similar image size"><Scaling size={16} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="option-control-group">
                    <strong>Apply to all option images</strong>
                    <div className="option-image-toolbar dense" aria-label="Bulk option image controls">
                      {[25, 40, 60, 75, 100].map((width) => <button type="button" key={width} onClick={() => updateAllOptionImages({ imageWidth: width })} title={`Set all option images to ${width}%`}>{width}</button>)}
                      <label className="toolbar-number-field" title="Set all option images to a custom width percentage">
                        <input type="number" min={5} max={180} value={bulkOptionImageWidth} onChange={(event) => setBulkOptionImageWidth(Number(event.target.value || 60))} />
                        <button type="button" onClick={() => updateAllOptionImages({ imageWidth: bulkOptionImageWidth })}>%</button>
                      </label>
                      <span className="option-image-toolbar-divider" aria-hidden="true" />
                      <button type="button" onClick={() => updateAllOptionImages({ imageAlign: "left" })} title="Align all option images left"><AlignLeft size={16} /></button>
                      <button type="button" onClick={() => updateAllOptionImages({ imageAlign: "center" })} title="Center all option images"><AlignCenter size={16} /></button>
                      <button type="button" onClick={() => updateAllOptionImages({ imageAlign: "right" })} title="Align all option images right"><AlignRight size={16} /></button>
                      <span className="option-image-toolbar-divider" aria-hidden="true" />
                      <button type="button" onClick={() => updateAllOptionImages({ imageHeight: 0, imageOffsetX: 0, imageOffsetY: 0 })} title="Reset all option image frames">Reset</button>
                    </div>
                  </div>
                  <label className="option-gap-control"><span>Option gap</span><input type="range" min={0} max={18} value={optionGapPx} onChange={(event) => setOptionGapPx(Number(event.target.value))} /><strong>{optionGapPx}px</strong></label>
                </div>
              ) : null}
              {optionLayout === "table" ? (
                <div className="table-option-editor">
                  <div className="section-intro compact"><strong>Table answer options</strong><span>Edit the headings and A-D row cells. Select the correct answer by clicking the row letter.</span></div>
                  <div className="table-editor-actions">
                    <button className="secondary-action" type="button" onClick={addTableColumn}><Plus size={15} />Add column</button>
                    <button className="secondary-action" type="button" onClick={() => setOptionLayout("single")}>Use normal options</button>
                    <button className={`secondary-action ${tableShowBorders ? "active-soft" : ""}`} type="button" onClick={() => setTableShowBorders((value) => !value)}>Borders</button>
                    <button className={`secondary-action ${tableShowHeaders ? "active-soft" : ""}`} type="button" onClick={() => setTableShowHeaders((value) => !value)}>Headings</button>
                  </div>
                  <div className="table-option-scroll">
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
                        ...tableHeaders.map((_, index) => (
                          <div className="table-cell-editor" key={`${option.label}-${index}`}>
                            <input value={tableRows[option.label]?.[index] ?? ""} onChange={(event) => updateTableCell(option.label, index, event.target.value)} placeholder="text or $equation$" />
                            <label title="Attach image to this table cell">
                              <Image size={14} />
                              <input
                                type="file"
                                accept="image/*"
                                disabled={isUploadingAsset}
                                onChange={(event) => uploadAsset(event.target.files?.[0] ?? null, "table_cell", (asset) => updateTableCellAsset(option.label, index, asset.id))}
                              />
                            </label>
                            {tableCellAssets[option.label]?.[index] ? <button type="button" onClick={() => updateTableCellAsset(option.label, index, null)}>Clear</button> : null}
                          </div>
                        )),
                        <button className="icon-button danger-icon" disabled={options.length <= 2} key={`${option.label}-delete`} onClick={() => removeOption(options.findIndex((item) => item.label === option.label))}><Trash2 size={15} /></button>,
                      ])}
                    </div>
                    <div className="table-column-removers" style={{ gridTemplateColumns: `72px repeat(${tableHeaders.length}, minmax(140px, 1fr)) 44px` }}>
                      <span />
                      {tableHeaders.map((_, index) => <button className="mini-step-button" disabled={tableHeaders.length <= 1} key={index} onClick={() => removeTableColumn(index)}>Remove</button>)}
                      <span />
                    </div>
                  </div>
                  <button className="secondary-action" onClick={addOption}><Plus size={16} />Add option row</button>
                </div>
              ) : (
                <>
                  <div className="structured-options-shell">
                    <div className="section-intro compact paper-editor-note">
                      <strong>Edit answers in paper regions</strong>
                      <span>Each option has its own editor, image attachment, and image controls. TeacherDesk still keeps A-D structured for shuffling, marking, and answer keys.</span>
                    </div>
                    <div className={`option-editor-list structured-option-grid layout-${optionLayout}`}>
                      {options.map((option, index) => (
                        <div className={`option-editor-card structured-option-card ${correctOption === option.label ? "correct" : ""}`} key={option.label}>
                          <div className="option-card-head">
                            <button className="option-letter" onClick={() => setCorrectOption(option.label)} title="Mark as correct">{option.label}</button>
                            <div><strong>{correctOption === option.label ? "Correct answer" : "Answer option"}</strong><span>Type text and LaTeX here; attach and tune images below.</span></div>
                            <button className="icon-button" disabled={options.length <= 2} onClick={() => removeOption(index)}><Trash2 size={15} /></button>
                          </div>
                          <OptionTextEditor
                            value={option.text}
                            label={option.label}
                            isCorrect={correctOption === option.label}
                            onChange={(value) => updateOption(index, { text: value })}
                            onPasteImage={(file) => uploadAsset(file, "option", (asset) => updateOption(index, { assetId: asset.id }))}
                          />
                          <div className="option-asset-row"><label className="compact-upload-button"><UploadCloud size={15} />Upload image<input type="file" accept="image/*" disabled={isUploadingAsset} onChange={(event) => uploadAsset(event.target.files?.[0] ?? null, "option", (asset) => updateOption(index, { assetId: asset.id }))} /></label><select className="styled-select" value={option.assetId ?? ""} onChange={(event) => updateOption(index, { assetId: event.target.value ? Number(event.target.value) : null })}><option value="">No option image</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.original_name}</option>)}</select>{option.assetId ? <button className="secondary-action" type="button" onClick={() => updateOption(index, { assetId: null })}>Remove</button> : null}</div>
                          {option.assetId ? (
                            <div className="option-image-tools extended">
                              <label><span>Width %</span><input type="number" min="5" max="180" value={option.imageWidth} onChange={(event) => updateOption(index, { imageWidth: Number(event.target.value) })} /></label>
                              <label><span>Height px</span><input type="number" min="0" max="260" value={option.imageHeight} onChange={(event) => updateOption(index, { imageHeight: Number(event.target.value) })} /></label>
                              <label><span>X shift</span><input type="number" min="-120" max="120" value={option.imageOffsetX} onChange={(event) => updateOption(index, { imageOffsetX: Number(event.target.value) })} /></label>
                              <label><span>Y shift</span><input type="number" min="-120" max="120" value={option.imageOffsetY} onChange={(event) => updateOption(index, { imageOffsetY: Number(event.target.value) })} /></label>
                              <div className="option-image-mini-toolbar">
                                <button className={option.imageAlign === "left" ? "active" : ""} type="button" onClick={() => updateOption(index, { imageAlign: "left" })} title="Align this image left"><AlignLeft size={16} /></button>
                                <button className={option.imageAlign === "center" ? "active" : ""} type="button" onClick={() => updateOption(index, { imageAlign: "center" })} title="Center this image"><AlignCenter size={16} /></button>
                                <button className={option.imageAlign === "right" ? "active" : ""} type="button" onClick={() => updateOption(index, { imageAlign: "right" })} title="Align this image right"><AlignRight size={16} /></button>
                              </div>
                              <select className="styled-select" value={option.imageFit} onChange={(event) => updateOption(index, { imageFit: event.target.value === "cover" ? "cover" : "contain" })}><option value="contain">Fit whole image</option><option value="cover">Crop to frame</option></select>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
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
                <label className="field-stack"><span>Exam code</span><input value={examCode} onBlur={applyExamCodeDefaults} onChange={(event) => setExamCode(event.target.value)} placeholder="9702_w23_qp_11" /></label>
                <label className="field-stack"><span>Paper code</span><input value={paperCode} onChange={(event) => setPaperCode(event.target.value)} placeholder="Paper 1" /></label>
                <label className="field-stack"><span>Session</span><input value={session} onChange={(event) => setSession(event.target.value)} placeholder="Oct/Nov" /></label>
                <label className="field-stack"><span>Year</span><input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2023" /></label>
                <label className="field-stack"><span>Source</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Manual / Cambridge / worksheet" /></label>
                <label className="field-stack"><span>Original question</span><div className="prefixed-input"><span>Q</span><input value={sourceQuestionNumber} onChange={(event) => setSourceQuestionNumber(sourceQuestionDigits(event.target.value))} placeholder="12" /></div></label>
                <label className="field-stack"><span>Difficulty</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{difficultyOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              </div>
              <div ref={metadataPickerRef} className="metadata-picker-zone">
              {renderMetadataPicker("topics", "Topics", newTopicName, setNewTopicName, metadata?.topics ?? [], topicIds, setTopicIds, saveQuickTopic, "Type to search or add a topic")}
              {visibleSubtopics.length ? <div className="metadata-picker"><strong>Subtopics</strong><div className="checkbox-chip-grid">{visibleSubtopics.map((subtopic) => <button className={subtopicIds.includes(subtopic.id) ? "active" : ""} key={subtopic.id} type="button" onClick={() => toggleNumberValue(subtopic.id, subtopicIds, setSubtopicIds)}><Check size={14} />{subtopic.name}</button>)}</div></div> : null}
              {renderMetadataPicker("tags", "Tags", newTagName, setNewTagName, metadata?.tags ?? [], tagIds, setTagIds, saveQuickTag, "Type to search or add a tag")}
              </div>
              <label className="field-stack"><span>Teacher notes</span><textarea value={teacherNotes} onChange={(event) => setTeacherNotes(event.target.value)} placeholder="Private notes for review, source details, or teaching remarks." /></label>
            </div>
          ) : null}

          <div className="mcq-bottom-controls">{stepLabels.length > 1 ? <button className="secondary-action" disabled={step === "question"} onClick={() => setStep(stepLabels[Math.max(stepLabels.findIndex((item) => item.value === step) - 1, 0)].value)}>Back</button> : null}{stepLabels.length > 1 ? <button className="secondary-action" disabled={step === "metadata"} onClick={() => setStep(stepLabels[Math.min(stepLabels.findIndex((item) => item.value === step) + 1, stepLabels.length - 1)].value)}>Continue</button> : null}<button className="secondary-action" disabled={isSaving} onClick={() => saveQuestion(false)}><Save size={16} />Save</button><button className="primary-action" disabled={isSaving} onClick={() => saveQuestion(true)}><Plus size={16} />Save and add another</button></div>
        </div>

        <aside className="panel mcq-preview-panel sticky-preview">
          <div ref={metadataPickerRef} className="side-metadata-panel top-metadata-panel">
            <div className="dashboard-widget-head compact-head"><div><strong>Question details</strong><span>Filtering and answer key data.</span></div></div>
            {!sourceQuestionNumber.trim() ? <div className="callout warning compact-callout">Original question number is empty.</div> : null}
            <div className="side-metadata-grid">
              <label className="field-stack compact wide"><span>Exam code</span><input value={examCode} onBlur={applyExamCodeDefaults} onChange={(event) => setExamCode(event.target.value)} placeholder="9702_w23_qp_11" /></label>
              <label className="field-stack compact"><span>Original question</span><div className="prefixed-input"><span>Q</span><input value={sourceQuestionNumber} onChange={(event) => setSourceQuestionNumber(sourceQuestionDigits(event.target.value))} placeholder="12" /></div></label>
              <label className="field-stack compact"><span>Difficulty</span><select className="styled-select" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{difficultyOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <div className="metadata-picker-zone compact-side">
              {renderMetadataPicker("topics", "Topics", newTopicName, setNewTopicName, metadata?.topics ?? [], topicIds, setTopicIds, saveQuickTopic, "Search or add a topic")}
              {visibleSubtopics.length ? <div className="metadata-picker compact-combo"><strong>Subtopics</strong><div className="checkbox-chip-grid">{visibleSubtopics.map((subtopic) => <button className={subtopicIds.includes(subtopic.id) ? "active" : ""} key={subtopic.id} type="button" onClick={() => toggleNumberValue(subtopic.id, subtopicIds, setSubtopicIds)}><Check size={14} />{subtopic.name}</button>)}</div></div> : null}
              {renderMetadataPicker("tags", "Tags", newTagName, setNewTagName, metadata?.tags ?? [], tagIds, setTagIds, saveQuickTag, "Search or add a tag")}
            </div>
            <label className="field-stack compact"><span>Teacher notes</span><textarea value={teacherNotes} onChange={(event) => setTeacherNotes(event.target.value)} placeholder="Private notes for review, source details, or teaching remarks." /></label>
          </div>
          <div className="dashboard-widget-head"><div><strong>A4 live preview</strong><span>Student-facing layout, using your selected structure.</span></div></div>
          <div className="a4-preview-viewport" ref={previewScaleRef}>
            <div className="a4-scale-shell" style={{ "--a4-scale": previewScale } as CSSProperties}>
              <MCQA4Question
                questionNumber={1}
                layoutPreset={layoutPreset}
                richContent={richContentHasContent() ? richContent : null}
                options={[]}
                optionLayout={optionLayout}
                optionImageLayout={{
                  placement: optionImagePlacement,
                  sizing: optionImageSizing,
                  label_placement: optionLabelPlacement,
                  label_align: optionLabelAlign,
                  content_align: optionContentAlign,
                  table_borders: tableShowBorders,
                  table_headers: tableShowHeaders,
                }}
                paperStyle={{ font_family: paperFontFamily, font_size_pt: paperFontSizePt, equation_scale: equationScale, option_gap_px: optionGapPx }}
                emptyText="Write the question, insert equations, add images, or create a table."
              />
            </div>
          </div>
          <div className="metadata-mini"><span><Check size={15} />{reviewStatus.replace("_", " ")}</span><span>{marks} mark</span><span>{optionLayout.replace("_", " ")}</span></div>
        </aside>
      </section>
    </>
  );
}
