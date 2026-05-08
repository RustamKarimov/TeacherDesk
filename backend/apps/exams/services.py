import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from django.db.models import QuerySet
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, NameObject

from apps.catalog.models import Question
from apps.exams.models import GeneratedExam
from apps.libraries.models import AppSettings, Library


DEFAULT_PAPER_MARKS = {
    1: 40,
    2: 60,
    3: 40,
    4: 100,
    5: 30,
}

IGNORED_BALANCE_TOPICS = {"Physical quantities and units"}

PAPER_TOPIC_GROUPS = {
    2: {
        "Motion": {"Kinematics"},
        "Forces and Matter": {"Dynamics", "Forces, density and pressure"},
        "Energy and Materials": {"Work, energy and power", "Deformation of solids"},
        "Waves": {"Waves", "Superposition"},
        "Electric Circuits": {"Electricity", "D.C. circuits"},
        "Modern Physics": {"Particle physics"},
    },
    4: {
        "Further Mechanics and Fields": {"Motion in a circle", "Gravitational fields"},
        "Thermal Physics": {"Temperature", "Ideal gases", "Thermodynamics"},
        "Oscillations and Waves": {"Oscillations", "Waves", "Superposition"},
        "Electric Fields and Capacitance": {"Electric fields", "Capacitance"},
        "Magnetism and Alternating Currents": {"Magnetic fields", "Alternating currents"},
        "Quantum and Nuclear Physics": {"Quantum physics", "Nuclear physics"},
        "Applications and Options": {"Medical physics", "Astronomy and cosmology"},
    },
}


def configured_paper_marks() -> dict[int, int]:
    library = Library.objects.filter(is_active=True).first() or Library.objects.first()
    settings = AppSettings.objects.filter(library=library).first() if library else None
    if not settings or not settings.paper_marks:
        return DEFAULT_PAPER_MARKS
    configured = DEFAULT_PAPER_MARKS.copy()
    configured.update({int(key): int(value) for key, value in settings.paper_marks.items() if str(value).isdigit()})
    return configured


@dataclass
class GenerationResult:
    selected: list[Question]
    warnings: list[str]
    target_marks: int | None = None


def question_payload(question: Question) -> dict[str, Any]:
    return {
        "id": question.id,
        "paper": f"Paper{question.paper_number}",
        "paper_number": question.paper_number,
        "question": f"Q{question.question_number}",
        "question_number": question.question_number,
        "exam": question.exam_code,
        "component": question.component,
        "session": question.session,
        "topics": list(question.topics.values_list("name", flat=True)),
        "marks": question.marks,
        "qp_status": question.qp_review_status,
        "ms_status": question.ms_review_status,
        "split_qp_path": question.split_qp_path,
        "split_ms_path": question.split_ms_path,
    }


def base_queryset(paper_number: int) -> QuerySet[Question]:
    return Question.objects.prefetch_related("topics").filter(paper_number=paper_number, split_qp_path__gt="").distinct()


def _topic_names(question: Question) -> set[str]:
    return {topic.name for topic in question.topics.all()}


def _balance_groups_for_question(question: Question, paper_number: int) -> set[str]:
    topic_names = _topic_names(question) - IGNORED_BALANCE_TOPICS
    groups = PAPER_TOPIC_GROUPS.get(paper_number, {})
    return {group_name for group_name, group_topics in groups.items() if topic_names & group_topics}


def _eligible_balance_groups(candidates: list[Question], paper_number: int) -> set[str]:
    groups: set[str] = set()
    for question in candidates:
        groups.update(_balance_groups_for_question(question, paper_number))
    return groups


def parse_question_numbers(text: str) -> list[int]:
    numbers: set[int] = set()
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        range_match = re.fullmatch(r"(\d+)\s*-\s*(\d+)", part)
        if range_match:
            start = int(range_match.group(1))
            end = int(range_match.group(2))
            if start > end:
                start, end = end, start
            numbers.update(range(start, end + 1))
            continue
        if part.isdigit():
            numbers.add(int(part))
            continue
        raise ValueError(f"Could not understand question number entry: {part}")
    return sorted(numbers)


def generate_full_paper(paper_number: int, target_marks: int | None = None, tolerance: int = 4) -> GenerationResult:
    candidates = list(base_queryset(paper_number))
    by_number: dict[int, list[Question]] = {}
    for question in candidates:
        by_number.setdefault(question.question_number, []).append(question)

    selected: list[Question] = []
    warnings: list[str] = []
    target = target_marks or configured_paper_marks().get(paper_number)
    eligible_groups = _eligible_balance_groups(candidates, paper_number)
    group_counts = {group_name: 0 for group_name in eligible_groups}

    def selection_score(question: Question, current_total: int) -> tuple[float, float, float]:
        groups = _balance_groups_for_question(question, paper_number)
        if groups:
            lowest_group_count = min(group_counts.get(group_name, 0) for group_name in groups)
            repeated_group_load = sum(group_counts.get(group_name, 0) for group_name in groups) / len(groups)
        else:
            lowest_group_count = 99
            repeated_group_load = 99

        projected_total = current_total + (question.marks or 0)
        mark_distance = abs((target or projected_total) - projected_total)
        return (lowest_group_count, repeated_group_load, mark_distance)

    def choose_balanced(options: list[Question], current_total: int) -> Question:
        scored = [(selection_score(question, current_total), question) for question in options]
        best_score = min(score for score, _question in scored)
        best_group_count, best_group_load, best_mark_distance = best_score
        close_options = [
            question
            for score, question in scored
            if score[0] == best_group_count
            and score[1] <= best_group_load + 0.5
            and score[2] <= best_mark_distance + 4
        ]
        return random.choice(close_options or options)

    for question_number in sorted(by_number):
        options = by_number[question_number][:]
        random.shuffle(options)
        current_total = sum(question.marks or 0 for question in selected)
        chosen: Question | None = None

        if target is None:
            chosen = choose_balanced(options, current_total)
            selected.append(chosen)
            for group_name in _balance_groups_for_question(chosen, paper_number):
                if group_name in group_counts:
                    group_counts[group_name] += 1
            continue

        acceptable = [
            question
            for question in options
            if current_total + (question.marks or 0) <= target + tolerance
        ]
        if acceptable:
            chosen = choose_balanced(acceptable, current_total)
            selected.append(chosen)
        else:
            best = choose_balanced(options, current_total)
            projected = current_total + (best.marks or 0)
            if not selected or abs(target - projected) < abs(target - current_total):
                chosen = best
                selected.append(chosen)

        if chosen:
            for group_name in _balance_groups_for_question(chosen, paper_number):
                if group_name in group_counts:
                    group_counts[group_name] += 1

    if not selected:
        warnings.append(f"No questions found for Paper {paper_number}.")
    elif eligible_groups:
        covered_groups = {group_name for group_name, count in group_counts.items() if count > 0}
        missing_groups = sorted(eligible_groups - covered_groups)
        if missing_groups:
            warnings.append(
                "Full paper topic spread could not include: "
                + ", ".join(missing_groups)
                + ". TeacherDesk kept one question per question number and respected the mark limit first."
            )
    return GenerationResult(selected=selected, warnings=warnings, target_marks=target)


def generate_by_question_numbers(paper_number: int, question_numbers: list[int]) -> GenerationResult:
    queryset = base_queryset(paper_number)
    selected: list[Question] = []
    warnings: list[str] = []

    for question_number in question_numbers:
        options = list(queryset.filter(question_number=question_number))
        if not options:
            warnings.append(f"No Paper {paper_number} Q{question_number} questions found.")
            continue
        selected.append(random.choice(options))

    return GenerationResult(selected=selected, warnings=warnings)


def _row_matches_allowed_topics(question: Question, required_topics: list[str], allowed_topics: list[str]) -> bool:
    question_topics = set(question.topics.values_list("name", flat=True))
    required = set(required_topics)
    allowed = set(allowed_topics)
    if not required.issubset(question_topics):
        return False
    extra_topics = question_topics - required
    return extra_topics.issubset(allowed)


def _diverse_topic_pick(options: list[Question], count: int) -> list[Question]:
    pool = options[:]
    random.shuffle(pool)
    picked: list[Question] = []
    used_ids: set[int] = set()
    exam_counts: dict[str, int] = {}
    question_number_counts: dict[int, int] = {}

    while pool and len(picked) < count:
        def score(question: Question) -> tuple[int, int, float]:
            return (
                exam_counts.get(question.exam_code, 0),
                question_number_counts.get(question.question_number, 0),
                random.random(),
            )

        next_question = min((question for question in pool if question.id not in used_ids), key=score, default=None)
        if next_question is None:
            break
        picked.append(next_question)
        used_ids.add(next_question.id)
        exam_counts[next_question.exam_code] = exam_counts.get(next_question.exam_code, 0) + 1
        question_number_counts[next_question.question_number] = question_number_counts.get(next_question.question_number, 0) + 1
        pool = [question for question in pool if question.id != next_question.id]

    return picked


def generate_by_topic_rows(paper_number: int, rows: list[dict[str, Any]]) -> GenerationResult:
    queryset = base_queryset(paper_number)
    selected: list[Question] = []
    selected_ids: set[int] = set()
    warnings: list[str] = []

    for index, row in enumerate(rows, start=1):
        required_topics = [topic for topic in row.get("required_topics", []) if topic]
        allowed_topics = [topic for topic in row.get("allowed_topics", []) if topic]
        count = int(row.get("count") or 1)

        if not required_topics:
            warnings.append(f"Topic row {index} was skipped because no required topics were selected.")
            continue

        options = [
            question
            for question in queryset
            if question.id not in selected_ids and _row_matches_allowed_topics(question, required_topics, allowed_topics)
        ]
        picked = _diverse_topic_pick(options, count)
        selected.extend(picked)
        selected_ids.update(question.id for question in picked)

        if len(picked) < count:
            warnings.append(f"Topic row {index} requested {count} question(s), but only {len(picked)} matched.")

    return GenerationResult(selected=selected, warnings=warnings)


def generate_manual_selection(question_ids: list[int]) -> GenerationResult:
    if not question_ids:
        raise ValueError("Select at least one question before adding to an exam.")

    unique_ids = list(dict.fromkeys(int(question_id) for question_id in question_ids))
    questions = list(Question.objects.prefetch_related("topics").filter(id__in=unique_ids))
    found_by_id = {question.id: question for question in questions}
    missing = [question_id for question_id in unique_ids if question_id not in found_by_id]
    if missing:
        raise ValueError(f"Some selected questions were not found: {missing}")

    ordered = [found_by_id[question_id] for question_id in unique_ids]
    return GenerationResult(selected=ordered, warnings=[])


def result_payload(result: GenerationResult) -> dict[str, Any]:
    total_marks = sum(question.marks or 0 for question in result.selected)
    return {
        "count": len(result.selected),
        "total_marks": total_marks,
        "target_marks": result.target_marks,
        "warnings": result.warnings,
        "questions": [question_payload(question) for question in result.selected],
    }


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return cleaned.strip("_") or "generated_exam"


def _mask_pdf_page(page, writer: PdfWriter, document_type: str, mask_settings: dict[str, Any]):
    header_enabled = bool(mask_settings.get(f"{document_type}_header_enabled"))
    footer_enabled = bool(mask_settings.get(f"{document_type}_footer_enabled"))
    header_mm = float(mask_settings.get(f"{document_type}_header_mm") or 0)
    footer_mm = float(mask_settings.get(f"{document_type}_footer_mm") or 0)

    if not header_enabled and not footer_enabled:
        return page

    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    commands = ["q", "1 1 1 rg"]
    if header_enabled and header_mm > 0:
        header_points = header_mm * 72 / 25.4
        commands.append(f"0 {height - header_points:.4f} {width:.4f} {header_points:.4f} re f")
    if footer_enabled and footer_mm > 0:
        footer_points = footer_mm * 72 / 25.4
        commands.append(f"0 0 {width:.4f} {footer_points:.4f} re f")
    commands.append("Q")

    overlay = DecodedStreamObject()
    overlay.set_data(("\n".join(commands) + "\n").encode("ascii"))
    overlay_reference = writer._add_object(overlay)
    original = page.get(NameObject("/Contents"))
    if original is None:
        page[NameObject("/Contents")] = overlay_reference
    elif isinstance(original, ArrayObject):
        page[NameObject("/Contents")] = ArrayObject([*original, overlay_reference])
    else:
        page[NameObject("/Contents")] = ArrayObject([original, overlay_reference])
    return page


def _mask_settings_for_exam(exam: GeneratedExam, override: dict[str, Any] | None = None) -> dict[str, Any]:
    if override is not None:
        return override
    snapshot = exam.settings_snapshot or {}
    snapshot_masks = snapshot.get("pdf_mask_settings")
    if isinstance(snapshot_masks, dict):
        return snapshot_masks
    if exam.library_id:
        settings = AppSettings.objects.filter(library=exam.library).first()
        return settings.pdf_mask_settings if settings else {}
    return {}


def ordered_exam_questions(exam: GeneratedExam) -> list[Question]:
    questions = list(exam.questions.prefetch_related("topics"))
    by_id = {question.id: question for question in questions}
    raw_order = (exam.settings_snapshot or {}).get("question_order")
    if isinstance(raw_order, list):
        ordered: list[Question] = []
        used_ids: set[int] = set()
        for raw_id in raw_order:
            try:
                question_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            question = by_id.get(question_id)
            if question and question_id not in used_ids:
                ordered.append(question)
                used_ids.add(question_id)
        if ordered:
            ordered.extend(
                sorted(
                    (question for question in questions if question.id not in used_ids),
                    key=lambda question: (question.paper_number, question.question_number, question.exam_code),
                )
            )
            return ordered

    return sorted(questions, key=lambda question: (question.paper_number, question.question_number, question.exam_code))


def combine_question_pdfs(exam: GeneratedExam, output_root: str, mask_settings_override: dict[str, Any] | None = None, include_markscheme: bool = True) -> dict[str, Any]:
    root_dir = Path(output_root).expanduser().resolve()
    folder_name = safe_filename(exam.title)
    output_dir = root_dir / folder_name
    counter = 2
    while output_dir.exists():
        output_dir = root_dir / f"{folder_name}_{counter}"
        counter += 1
    output_dir.mkdir(parents=True, exist_ok=True)

    questions = ordered_exam_questions(exam)
    if not questions:
        raise ValueError("This draft has no questions.")

    base_name = safe_filename(exam.title)
    qp_output = output_dir / f"{base_name}_QP.pdf"
    ms_output = output_dir / f"{base_name}_MS.pdf"
    mask_settings = _mask_settings_for_exam(exam, mask_settings_override)

    outputs = []
    documents = [("qp", qp_output)]
    if include_markscheme:
        documents.append(("ms", ms_output))

    for document_type, output_path in documents:
        writer = PdfWriter()
        missing: list[str] = []
        for question in questions:
            source = question.split_qp_path if document_type == "qp" else question.split_ms_path
            if not source or not Path(source).exists():
                missing.append(f"{question.exam_code} Q{question.question_number}: {source}")
                continue
            reader = PdfReader(source)
            for page in reader.pages:
                output_page = writer.add_page(page)
                _mask_pdf_page(output_page, writer, document_type, mask_settings)

        if missing:
            raise ValueError(f"Missing {document_type.upper()} files: {'; '.join(missing[:5])}")

        with output_path.open("wb") as file:
            writer.write(file)
        outputs.append(str(output_path))

    exam.exam_pdf_path = str(qp_output)
    exam.markscheme_pdf_path = str(ms_output) if include_markscheme else ""
    exam.save(update_fields=["exam_pdf_path", "markscheme_pdf_path"])

    return {
        "exam_pdf_path": str(qp_output),
        "markscheme_pdf_path": str(ms_output) if include_markscheme else "",
        "output_folder": str(output_dir),
        "question_count": len(questions),
    }
