export type ReviewStatus = "Needs review" | "Reviewed" | "Not required";

export type ValidationIssue = {
  severity: "error" | "warning" | "info";
  row: number | null;
  exam_code: string | null;
  question_number?: number | null;
  message: string;
};

export type ValidationReport = {
  ok: boolean;
  summary: {
    rows: number;
    errors: number;
    warnings: number;
    info: number;
    starred_boundaries: number;
    review_required_items: number;
    topics: number;
    source_root: string;
    manifest_path: string;
  };
  issues: ValidationIssue[];
};

export type SplitReport = {
  ok: boolean;
  message: string;
  validation: ValidationReport;
  summary: {
    created_questions: number;
    updated_questions: number;
    split_question_pdfs: number;
    split_markscheme_pdfs: number;
    skipped_existing_files: number;
    review_required_items: number;
    records_ready?: number;
    library_root: string;
  };
  outputs: Array<{
    exam_code: string;
    question_number: number;
    qp_pages: [number, number];
    ms_pages: [number, number];
    qp_output: string;
    ms_output: string;
    qp_review_status: string;
    ms_review_status: string;
  }>;
};

export type SplitJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: {
    processed_files: number;
    total_files: number;
    split_question_pdfs: number;
    split_markscheme_pdfs: number;
    skipped_existing_files: number;
    current: {
      exam_code?: string;
      question_number?: number;
      document_type?: string;
      output?: string;
    };
  };
  result: SplitReport | null;
  error: string | null;
};

export type SplitPlan = {
  ok: boolean;
  message: string;
  validation: ValidationReport;
  summary: {
    records: number;
    files_total: number;
    files_to_create: number;
    files_to_skip_existing: number;
    files_to_overwrite: number;
    files_to_version: number;
    page_range_changes: number;
    questions_to_create: number;
    questions_to_update: number;
    review_required_items: number;
    library_root: string;
  };
  items: Array<{
    exam_code: string;
    question_number: number;
    paper: string;
    qp_action: string;
    ms_action: string;
    qp_range_changed: boolean;
    ms_range_changed: boolean;
    qp_review_required: boolean;
    ms_review_required: boolean;
  }>;
};

export type QuestionBankRow = {
  id: number;
  paper: string;
  paper_number: number;
  question: string;
  question_number: number;
  exam: string;
  component: string;
  session: string;
  topics: string[];
  marks: number | null;
  qp_status: ReviewStatus;
  ms_status: ReviewStatus;
  qp_status_value: string;
  ms_status_value: string;
  review_reason: string;
  split_qp_path: string;
  split_ms_path: string;
  qp_pages: [number | null, number | null];
  ms_pages: [number | null, number | null];
};

export type GeneratedQuestion = {
  id: number;
  paper: string;
  paper_number: number;
  question: string;
  question_number: number;
  exam: string;
  component: string;
  session: string;
  topics: string[];
  marks: number | null;
  qp_status: string;
  ms_status: string;
};

export type GeneratedExamPreview = {
  count: number;
  total_marks: number;
  target_marks: number | null;
  warnings: string[];
  questions: GeneratedQuestion[];
};

export type SavedExamDraft = {
  id: number;
  title: string;
  mode: string;
  total_marks: number;
  question_count: number;
  exam_pdf_path: string;
  markscheme_pdf_path: string;
  created_at: string;
  questions?: GeneratedQuestion[];
  settings_snapshot?: Record<string, unknown>;
};

export type ExamAvailability = {
  question_counts?: Record<string, number>;
  topic_row_counts?: number[];
};

export type QuestionFilters = {
  papers: number[];
  question_numbers: number[];
  topics: Array<{ topic_number: number | null; name: string }>;
  review_statuses: Array<{ value: string; label: string }>;
};

export type ReviewDraft = {
  qp?: "needs_review" | "reviewed";
  ms?: "needs_review" | "reviewed";
};

export type MetadataDraft = {
  marks: string;
  topics: string[];
  qpReviewStatus: string;
  msReviewStatus: string;
  reviewReason: string;
};

export type ExamMode = "full_paper" | "question_numbers" | "topics" | "manual";

export type TopicRuleRow = {
  id: number;
  requiredTopics: string[];
  allowedTopics: string[];
  count: number;
};

export type AppSettingsPayload = {
  library: {
    id: number;
    name: string;
    root_path: string;
  };
  default_manifest_path: string;
  default_source_root: string;
  default_output_root: string;
  default_generated_exams_root: string;
  paper_marks: Record<string, number>;
  pdf_mask_settings: {
    qp_header_enabled: boolean;
    qp_footer_enabled: boolean;
    ms_header_enabled: boolean;
    ms_footer_enabled: boolean;
    qp_header_mm: number;
    qp_footer_mm: number;
    ms_header_mm: number;
    ms_footer_mm: number;
  };
  app_preferences: {
    splitter: {
      existing_pdf_strategy: "skip" | "overwrite";
      changed_page_strategy: "flag" | "overwrite" | "keep_both";
      metadata_strategy: "update" | "keep";
    };
    question_bank: {
      page_size: number;
      topic_match_mode: "any" | "all";
    };
    exam_generator: {
      default_paper: string;
      default_mode: ExamMode;
      allowed_over_target: number;
      include_markscheme: boolean;
    };
  };
};

export type PdfMaskSettings = AppSettingsPayload["pdf_mask_settings"];

export type DashboardPayload = {
  library: {
    name: string;
    root_path: string;
  };
  modules: Record<
    "splitter" | "question_bank" | "exam_generator" | "settings",
    {
      title: string;
      summary: string;
      primary: number;
      primary_label: string;
      secondary: number;
      secondary_label: string;
    }
  >;
  paths: {
    manifest: string;
    source: string;
    question_bank: string;
    generated_exams: string;
  };
  review_counts: {
    all: number;
    qp: number;
    ms: number;
  };
  folder_health: Array<{ label: string; path: string; ready: boolean }>;
  review_queue: Array<{ id: number; exam: string; paper: string; question: string; marks: number | null; qp_status: string; ms_status: string }>;
  recent_drafts: Array<{ id: number; title: string; mode: string; marks: number; questions: number; generated: boolean; paper: number | null; created_at: string }>;
  paper_coverage: Array<{ paper: number; questions: number; review_flags: number }>;
};
