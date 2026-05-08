# TeacherDesk Architecture

TeacherDesk is designed as a local-first modular system.

## Core Rule

The database stores metadata and paths. PDFs stay on the user's local device.

## Modules

### Libraries

A library represents one local workspace. It owns the root folder, source paper folder, QuestionBank folder, generated exams folder, and default naming preset.

### Splitter

The Splitter reads manifest records, validates source PDFs, calculates page ranges, writes split PDFs, and marks review-required outputs.

Starred page rule:

```text
If Q3 starts at 3* and Q4 starts at 7:
Q3 includes pages 3, 4, 5, 6, 7.
Q4 includes page 7 onward.
Both Q3 and Q4 are marked needs_review for the affected document type.
```

This applies independently to question papers and mark schemes.

### Question Bank

Split files are grouped by subject, paper, and question number:

```text
QuestionBank/9702/Paper4/Q5/Questions/9702_m22_qp_42_Q5.pdf
QuestionBank/9702/Paper4/Q5/MarkSchemes/9702_m22_ms_42_Q5.pdf
```

### Exam Generator

Generated exams are saved as records and output PDFs. This lets TeacherDesk reopen exams, avoid recently used questions, and later connect generated exams to student analysis.

## Cambridge Preset

Current default filename pattern:

```text
{subject_code}_{session}_{document_type}_{component}.pdf
```

Example:

```text
9702_s23_qp_42.pdf
9702_s23_ms_42.pdf
```

The mark scheme pairing rule is:

```text
replace "_qp_" with "_ms_"
```
