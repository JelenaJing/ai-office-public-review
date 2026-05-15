"""
Introduction Remake: extract intro, build tier-1-only literature pool, rewrite with citations.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, Iterator, List, Optional, Tuple

from openai import OpenAI

from app.config import (
    DEEPSEEK_API_KEY as LEGACY_DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL as LEGACY_DEEPSEEK_BASE_URL,
    DEEPSEEK_MAX_OUTPUT_TOKENS as LEGACY_DEEPSEEK_MAX_OUTPUT_TOKENS,
    DEEPSEEK_MODEL as LEGACY_DEEPSEEK_MODEL,
)
from app.services.text_cleaner import extract_clean_text
from app.services.paper_processor import PaperProcessor
from app.services.intro_literature import build_allowlisted_pool
from app.services.tier1_journals import allowed_journals_metadata
from app.agents.content_checker import extract_topic_from_text
from app.services.llm_stream import format_sse, format_sse_json, iter_chat_stream_deltas

logger = logging.getLogger(__name__)

DEFAULT_QWEN_MODEL = "qwen3.6-plus"
DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def _resolve_int(value: Optional[str], fallback: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return fallback


_QWEN_API_KEY = (os.getenv("AI_WRITER_DEFAULT_QWEN_API_KEY") or os.getenv("QWEN_API_KEY") or "").strip()
_LEGACY_API_KEY = (os.getenv("DEEPSEEK_API_KEY") or LEGACY_DEEPSEEK_API_KEY or "").strip()
USE_QWEN_DEFAULTS = bool(_QWEN_API_KEY) or not bool(_LEGACY_API_KEY)
LLM_API_KEY = _QWEN_API_KEY or _LEGACY_API_KEY
LLM_BASE_URL = (
    (os.getenv("QWEN_BASE_URL") or "").strip()
    or (DEFAULT_QWEN_BASE_URL if USE_QWEN_DEFAULTS else "")
    or (os.getenv("DEEPSEEK_BASE_URL") or LEGACY_DEEPSEEK_BASE_URL or "").strip()
    or DEFAULT_QWEN_BASE_URL
)
LLM_MODEL = (
    (os.getenv("QWEN_MODEL") or "").strip()
    or (DEFAULT_QWEN_MODEL if USE_QWEN_DEFAULTS else "")
    or (os.getenv("DEEPSEEK_MODEL") or LEGACY_DEEPSEEK_MODEL or "").strip()
    or DEFAULT_QWEN_MODEL
)
LLM_MAX_OUTPUT_TOKENS = _resolve_int(
    os.getenv("QWEN_MAX_OUTPUT_TOKENS") or os.getenv("DEEPSEEK_MAX_OUTPUT_TOKENS"),
    LEGACY_DEEPSEEK_MAX_OUTPUT_TOKENS,
)


def get_client() -> OpenAI:
    return OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


def extract_introduction_from_full_text(full_text: str) -> str:
    """LLM: locate Introduction section boundaries."""
    if not full_text or not full_text.strip():
        raise ValueError("全文为空，无法自动提取 Introduction")
    cap = 120_000
    body = full_text[:cap] if len(full_text) > cap else full_text
    client = get_client()
    prompt = f"""You are assisting with academic paper segmentation.

From the following paper full text (possibly with PDF extraction noise), extract ONLY the Introduction section body.

Rules:
- Start after a heading such as Introduction, INTRODUCTION, 引言, or implicit start if clearly the intro before Methods/Results.
- Stop before the next major section (e.g. Methods, Experimental, Results, Theory, Background as a new section after intro — use judgment).
- Return JSON only: {{"introduction": "<verbatim or lightly cleaned continuous text>"}}
- Do not invent content. If you cannot find an introduction, return {{"introduction": ""}}.

Paper text:
{body}
"""
    resp = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": "You output only valid JSON."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=8000,
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or ""
    try:
        data = json.loads(_strip_json_fence(raw))
    except json.JSONDecodeError as e:
        logger.warning(f"[IntroRemake] intro JSON parse failed: {e}")
        raise ValueError("无法解析 Introduction 提取结果，请改用手动选取 Introduction 文本") from e
    intro = (data.get("introduction") or "").strip()
    if not intro:
        raise ValueError("未能从全文中定位 Introduction，请改用手动选取 Introduction 文本")
    return intro


def _clamp_openalex_query(query: str, max_words: int = 6) -> str:
    """Keep a short OpenAlex `search` string (long queries hurt recall under journal filters)."""
    q = " ".join((query or "").split())
    if not q:
        return q
    words = q.split()
    if len(words) <= max_words:
        return q
    return " ".join(words[:max_words])


def _fallback_search_query_from_intro(intro_text: str) -> str:
    """If LLM fails: reuse content_checker topic string, then truncate to a few tokens."""
    raw = (extract_topic_from_text(intro_text) or "").strip()
    if not raw:
        return ""
    return _clamp_openalex_query(raw, max_words=5)


def extract_topic_and_min_year(intro_text: str) -> Tuple[str, int]:
    """
    Produce a **short** English OpenAlex `search` query + minimum publication year.

    Matches NFTCORE openalex.OpenAlexFetcher._extract_topic_and_persons idea: compress user/intro
    text to a few core keywords before search—do not pass long phrases or pseudo-titles.
    """
    client = get_client()
    prompt = f"""You analyze a paper introduction for downstream OpenAlex literature search.

From the text below, extract JSON with:
1) "openalex_search": a VERY SHORT English search string for OpenAlex **works** search.
   - Use ONLY 2 to 5 content words (or one short phrase of at most 6 words total).
   - Pick the single most important research concepts (e.g. "aggregation-induced emission organic room temperature phosphorescence").
   - Do NOT paste the paper title, do NOT copy full sentences, do NOT list every acronym—at most one well-known acronym if essential.
2) "persons": researcher names mentioned (0-3 names), for optional disambiguation in search; use [] if none.
3) "paper_publication_year": best estimate of THIS paper's publication year (integer), or null if unknown.
4) "category": exactly one of: Biological sciences | Chemistry | Earth & environmental sciences | Health sciences | Physical sciences

Return JSON only:
{{"openalex_search": "...", "persons": [], "paper_publication_year": 2020, "category": "Chemistry"}}

Introduction text:
{intro_text[:12000]}
"""
    resp = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {
                "role": "system",
                "content": "You output only valid JSON. openalex_search must stay short (few keywords only).",
            },
            {"role": "user", "content": prompt},
        ],
        max_tokens=400,
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or ""
    try:
        data = json.loads(_strip_json_fence(raw))
    except json.JSONDecodeError:
        logger.warning("[IntroRemake] literature meta JSON parse failed, using fallback keywords")
        fq = _fallback_search_query_from_intro(intro_text)
        return (fq if fq else intro_text[:80].strip(), 2015)

    core = (data.get("openalex_search") or data.get("topic") or "").strip()
    persons = data.get("persons") or []
    if not isinstance(persons, list):
        persons = []
    persons = [str(p).strip() for p in persons if str(p).strip()][:3]

    if not core:
        core = _fallback_search_query_from_intro(intro_text)

    combined = core
    if persons:
        combined = f"{core} {' '.join(persons)}".strip()

    combined = _clamp_openalex_query(combined, max_words=8)
    if not combined:
        combined = _fallback_search_query_from_intro(intro_text) or intro_text[:80].strip()

    py = data.get("paper_publication_year")
    try:
        year = int(py) if py is not None else 2015
    except (TypeError, ValueError):
        year = 2015
    year = max(1990, min(year, 2035))

    logger.info(
        f"[IntroRemake] OpenAlex search query (compressed): {combined!r}, year>={year}, persons={persons}"
    )
    return combined, year


def _pool_prompt_block(pool: List[Dict[str, Any]], abstract_max: int = 900) -> str:
    lines = []
    for p in pool:
        idx = p["pool_index"]
        ab = (p.get("abstract") or "")[:abstract_max]
        lines.append(
            f"[{idx}] {p.get('title', '')}\n"
            f"    Venue: {p.get('venue', '')}\n"
            f"    Authors: {p.get('authors', '')} | Year: {p.get('year', '')} | DOI: {p.get('doi', '')}\n"
            f"    Abstract: {ab}\n"
        )
    return "\n".join(lines)


def _rewrite_intro_llm(
    original_intro: str,
    pool: List[Dict[str, Any]],
    allowed_labels: List[Dict[str, Any]],
    context: Optional[str],
) -> Dict[str, Any]:
    n = len(pool)
    client = get_client()
    journals_lines = "\n".join(
        f"- {j.get('label', '')}: {len(j.get('source_ids', []))} OpenAlex source id(s)"
        for j in allowed_labels
    )
    ctx = f"\nAdditional user context:\n{context}\n" if context else ""
    prompt = f"""You are an expert scientific editor.

Task: Rewrite the Introduction so it naturally continues the same scientific narrative, but incorporates recent progress AFTER the original paper's time, using ONLY the provided literature pool. Every in-text citation MUST use square-bracket numbers [k] where k is the pool_index (1..{n}) of a paper listed below. You may use as many distinct citations as needed; all must come from this pool only.

Tier-1 journals policy (already enforced by the pool):
{journals_lines}

Original introduction:
{original_intro[:20000]}
{ctx}

Literature pool (ONLY valid citation targets):
{_pool_prompt_block(pool)}

Requirements:
1) Scientific, fluent, coherent with the original motivation and gap framing.
2) Add/update narrative using evidence from the pool abstracts; do not claim specifics absent from abstracts.
3) Fix or remove clearly inappropriate citations from the original (misattributed, irrelevant, redundant) — document in original_reference_audit.
4) Output valid JSON only (no markdown fences), schema:
{{
  "remade_introduction": "full rewritten introduction text with [1] style citations",
  "references": [
    {{"pool_index": 1, "note": "optional short note"}}
  ],
  "continuity_notes": "how the rewrite connects to the original",
  "original_reference_audit": [
    {{"issue": "...", "action": "removed|replaced|kept", "detail": "..."}}
  ]
}}

The "references" array should list every pool_index you cited at least once, in order of first appearance in remade_introduction.
"""
    resp = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": "You output only valid JSON. Citations must only use pool indices 1..N."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=LLM_MAX_OUTPUT_TOKENS,
        temperature=0.35,
    )
    raw = resp.choices[0].message.content or ""
    try:
        return json.loads(_strip_json_fence(raw))
    except json.JSONDecodeError as e:
        logger.error(f"[IntroRemake] rewrite JSON parse failed: {e}")
        raise ValueError("模型返回的 Introduction 重写结果不是合法 JSON，请重试") from e


# In-text citations like [12] or [14, 53] (pool_index from LLM, before sequential remap)
_IN_TEXT_CITE_RE = re.compile(r"\[((?:\s*\d+\s*,)*\s*\d+)\]")


def _split_bracket_citation_indices(inner: str) -> List[int]:
    out: List[int] = []
    for part in inner.split(","):
        p = part.strip()
        if p.isdigit():
            out.append(int(p))
    return out


def _citation_indices_in_text(text: str) -> List[int]:
    """All integers appearing inside citation brackets (pool or sequential)."""
    out: List[int] = []
    for m in _IN_TEXT_CITE_RE.finditer(text):
        out.extend(_split_bracket_citation_indices(m.group(1)))
    return out


def remap_introduction_citations_pool_to_sequential(
    text: str, pool: List[Dict[str, Any]]
) -> Tuple[str, List[int]]:
    """
    Replace pool_index-style brackets with 1..K by order of first appearance (normal paper style).
    Returns (new_text, pool_indices_in_reference_list_order) where ref [i] = pool_indices_in_reference_list_order[i-1].
    """
    valid_pool = {int(p["pool_index"]) for p in pool if p.get("pool_index") is not None}
    pool_to_seq: Dict[int, int] = {}
    seq_pool_order: List[int] = []

    def seq_for_pool(pi: int) -> int:
        if pi not in valid_pool:
            return pi  # unchanged token; validation may fail later
        if pi not in pool_to_seq:
            pool_to_seq[pi] = len(seq_pool_order) + 1
            seq_pool_order.append(pi)
        return pool_to_seq[pi]

    parts: List[str] = []
    pos = 0
    for m in _IN_TEXT_CITE_RE.finditer(text):
        parts.append(text[pos : m.start()])
        inner = m.group(1)
        pis = _split_bracket_citation_indices(inner)
        if not pis:
            parts.append(m.group(0))
        else:
            mapped: List[str] = []
            for pi in pis:
                s = seq_for_pool(pi)
                mapped.append(str(s))
            parts.append("[" + ", ".join(mapped) + "]")
        pos = m.end()
    parts.append(text[pos:])
    return "".join(parts), seq_pool_order


def _validate_sequential_citations(text: str, k: int) -> Tuple[bool, List[str]]:
    errs: List[str] = []
    if k <= 0:
        return True, []
    for m in _IN_TEXT_CITE_RE.finditer(text):
        for n in _split_bracket_citation_indices(m.group(1)):
            if n < 1 or n > k:
                errs.append(f"citation [{n}] out of sequential range 1..{k}")
    return len(errs) == 0, errs


def _validate_citations(remade: str, pool: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    errs: List[str] = []
    n = len(pool)
    if n == 0:
        return False, ["empty pool"]
    for k in _citation_indices_in_text(remade):
        if k < 1 or k > n:
            errs.append(f"citation [{k}] out of range 1..{n}")
    return len(errs) == 0, errs


def _iter_rewrite_intro_plain(
    original_intro: str,
    pool: List[Dict[str, Any]],
    allowed_labels: List[Dict[str, Any]],
    context: Optional[str],
) -> Iterator[str]:
    """Stream tokens for rewritten introduction (plain text, [k] citations)."""
    n = len(pool)
    client = get_client()
    journals_lines = "\n".join(
        f"- {j.get('label', '')}: {len(j.get('source_ids', []))} OpenAlex source id(s)"
        for j in allowed_labels
    )
    ctx = f"\nAdditional user context:\n{context}\n" if context else ""
    prompt = f"""You are an expert scientific editor.

Rewrite the Introduction so it naturally continues the same scientific narrative and incorporates recent progress using ONLY the literature pool below. Use in-text citations [k] where k is pool_index from 1..{n}. Output ONLY the rewritten introduction body (plain text). No JSON, no markdown code fences.

Tier-1 journals (enforced by pool):
{journals_lines}

Original introduction:
{original_intro[:20000]}
{ctx}

Literature pool:
{_pool_prompt_block(pool)}
"""
    yield from iter_chat_stream_deltas(
        client,
        LLM_MODEL,
        [
            {
                "role": "system",
                "content": f"You rewrite introductions; citations must use only integers 1..{n} in square brackets.",
            },
            {"role": "user", "content": prompt},
        ],
        max_tokens=LLM_MAX_OUTPUT_TOKENS,
        temperature=0.35,
    )


def _finalize_intro_metadata(
    remade_introduction: str,
    original_introduction: str,
    pool: List[Dict[str, Any]],
    allowed_labels: List[Dict[str, Any]],
    context: Optional[str],
    citation_pool_order: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Second pass: continuity notes + audit (JSON). References are built deterministically when citation_pool_order is set."""
    n = len(pool)
    client = get_client()
    ctx = f"\nUser context:\n{context}\n" if context else ""
    if citation_pool_order is not None:
        k = len(citation_pool_order)
        mapping_lines = "\n".join(
            f"In-text citation [{i + 1}] refers to literature pool_index {pi}"
            for i, pi in enumerate(citation_pool_order)
        )
        prompt = f"""You are assisting with bibliography metadata for an already-written introduction.

The remade introduction uses SEQUENTIAL in-text citations [1] through [{k}] (like a normal manuscript). They are NOT the raw pool slot numbers.

Mapping (do not change these numbers in your analysis):
{mapping_lines}

Remade introduction:
{remade_introduction[:24000]}

Original introduction (for audit):
{original_introduction[:12000]}
{ctx}

Literature pool (pool_index is internal; the reader sees only [1]..[{k}] above):
{_pool_prompt_block(pool, abstract_max=400)}

Return JSON only (no markdown fences). Do NOT include a "references" key.
{{
  "continuity_notes": "how the rewrite connects to the original",
  "original_reference_audit": [
    {{"issue": "...", "action": "removed|replaced|kept", "detail": "..."}}
  ]
}}
"""
    else:
        prompt = f"""You are assisting with bibliography metadata for an already-written introduction.

Remade introduction (final text, citations [1]..[{n}] pool indices):
{remade_introduction[:24000]}

Original introduction (for audit):
{original_introduction[:12000]}
{ctx}

Literature pool indices 1..{n} correspond to:
{_pool_prompt_block(pool, abstract_max=400)}

Return JSON only (no markdown fences):
{{
  "references": [{{"pool_index": 1, "note": ""}}],
  "continuity_notes": "how the rewrite connects to the original",
  "original_reference_audit": [
    {{"issue": "...", "action": "removed|replaced|kept", "detail": "..."}}
  ]
}}
The references array must include every pool_index cited in the remade introduction, ordered by first appearance.
"""
    resp = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": "You output only valid JSON."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=8000,
        temperature=0.25,
    )
    raw = resp.choices[0].message.content or ""
    try:
        data = json.loads(_strip_json_fence(raw))
    except json.JSONDecodeError:
        if citation_pool_order is not None:
            return {
                "references": [{"pool_index": pi, "note": ""} for pi in citation_pool_order],
                "continuity_notes": "",
                "original_reference_audit": [],
            }
        seen_order: List[int] = []
        for k in _citation_indices_in_text(remade_introduction):
            if 1 <= k <= n and k not in seen_order:
                seen_order.append(k)
        return {
            "references": [{"pool_index": i, "note": ""} for i in seen_order],
            "continuity_notes": "",
            "original_reference_audit": [],
        }
    if citation_pool_order is not None:
        data["references"] = [{"pool_index": pi, "note": ""} for pi in citation_pool_order]
    return data


def stream_introduction_remake_sse(
    project_id: str,
    selected_text: str,
    context: Optional[str] = None,
    auto_extract_intro: bool = False,
    max_papers_for_llm: int = 100,
) -> Iterator[bytes]:
    """SSE: meta -> delta* -> done (full introduction remake payload)."""
    try:
        allowed_meta = allowed_journals_metadata()

        if auto_extract_intro:
            proc = PaperProcessor()
            paper = proc.process_paper(project_id)
            full_text = paper.get("content") or ""
            intro_raw = extract_introduction_from_full_text(full_text)
        else:
            intro_raw = (selected_text or "").strip()
            if not intro_raw:
                yield format_sse("error", "未提供 Introduction 文本：请选中文本或开启 auto_extract_intro")
                return

        original_introduction = extract_clean_text(intro_raw)
        topic, paper_year = extract_topic_and_min_year(original_introduction)
        min_year = paper_year

        second_q = _clamp_openalex_query(f"{topic} review", max_words=8)
        paper_target = max(1, min(max_papers_for_llm, 200))
        pool, pool_meta = build_allowlisted_pool(
            topic=topic,
            min_publication_year=min_year,
            max_papers_for_llm=paper_target,
            second_pass_topic=second_q,
        )

        if len(pool) < paper_target:
            yield format_sse(
                "error",
                f"顶刊白名单内带摘要的文献不足（{len(pool)}/{paper_target}）。"
                "可调整 Introduction、放宽年份/主题，或扩展 tier1_journals.json。",
            )
            return

        yield format_sse_json(
            "meta",
            {
                "job": "introduction",
                "project_id": project_id,
                "allowed_journals": allowed_meta,
                "literature_pool": pool,
                "literature_pool_meta": pool_meta,
                "original_introduction": original_introduction,
                "search_topic": topic,
                "min_publication_year": min_year,
                "stage": "remade_intro_stream",
            },
        )

        parts: List[str] = []
        for frag in _iter_rewrite_intro_plain(
            original_introduction, pool, allowed_meta, context
        ):
            parts.append(frag)
            yield format_sse("delta", frag)

        remade = "".join(parts).strip()
        if not remade:
            yield format_sse("error", "模型未返回有效的重写正文")
            return

        ok, errs = _validate_citations(remade, pool)
        if not ok:
            logger.warning(
                f"[IntroRemake] stream cite validation failed: {errs}, falling back to sync rewrite"
            )
            try:
                parsed_sync = _rewrite_intro_llm(
                    original_introduction, pool, allowed_meta, context
                )
                remade = (parsed_sync.get("remade_introduction") or "").strip()
            except Exception as ex:
                yield format_sse("error", f"引用校验失败且同步重写失败: {errs}; {ex}")
                return
            ok2, errs2 = _validate_citations(remade, pool)
            if not ok2:
                yield format_sse("error", f"引用编号与文献池不一致: {errs2}")
                return

        remade, cite_pool_order = remap_introduction_citations_pool_to_sequential(remade, pool)
        ok_seq, errs_seq = _validate_sequential_citations(remade, len(cite_pool_order))
        if not ok_seq:
            yield format_sse("error", f"引用顺序编号校验失败: {'; '.join(errs_seq)}")
            return

        parsed = _finalize_intro_metadata(
            remade,
            original_introduction,
            pool,
            allowed_meta,
            context,
            citation_pool_order=cite_pool_order,
        )
        refs_raw = parsed.get("references") or []
        if not isinstance(refs_raw, list):
            refs_raw = []
        references = _enrich_references(refs_raw, pool)

        core = {
            "allowed_journals": allowed_meta,
            "literature_pool": pool,
            "literature_pool_meta": pool_meta,
            "original_introduction": original_introduction,
            "remade_introduction": remade,
            "references": references,
            "continuity_notes": parsed.get("continuity_notes") or "",
            "original_reference_audit": parsed.get("original_reference_audit") or [],
            "search_topic": topic,
            "min_publication_year": min_year,
        }
        from app.project_manager import ProjectManager

        ProjectManager().save_remake_result(
            project_id,
            "introduction",
            {
                **core,
                "auto_extract_intro": auto_extract_intro,
                "max_papers_for_llm": max_papers_for_llm,
                "context": context,
            },
        )
        done_payload = {
            "status": "success",
            "message": "Introduction remake completed",
            **core,
        }
        yield format_sse_json("done", done_payload)
    except ValueError as e:
        yield format_sse("error", str(e))
    except Exception as e:
        logger.error(f"[IntroRemake] Stream failed: {e}", exc_info=True)
        yield format_sse("error", str(e))


def _enrich_references(
    ref_entries: List[Dict[str, Any]], pool: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    by_idx = {p["pool_index"]: p for p in pool}
    out: List[Dict[str, Any]] = []
    for ord_i, r in enumerate(ref_entries, start=1):
        pi = r.get("pool_index")
        try:
            pi = int(pi)
        except (TypeError, ValueError):
            continue
        if pi not in by_idx:
            continue
        p = by_idx[pi]
        out.append(
            {
                "reference_number": ord_i,
                "pool_index": pi,
                "citation": p.get("citation"),
                "title": p.get("title"),
                "authors": p.get("authors"),
                "year": p.get("year"),
                "doi": p.get("doi"),
                "venue": p.get("venue"),
                "openalex_id": p.get("openalex_id"),
            }
        )
    return out


def remake_introduction(
    project_id: str,
    selected_text: str,
    context: Optional[str] = None,
    auto_extract_intro: bool = False,
    max_papers_for_llm: int = 100,
) -> Dict[str, Any]:
    allowed_meta = allowed_journals_metadata()

    if auto_extract_intro:
        proc = PaperProcessor()
        paper = proc.process_paper(project_id)
        full_text = paper.get("content") or ""
        intro_raw = extract_introduction_from_full_text(full_text)
    else:
        intro_raw = (selected_text or "").strip()
        if not intro_raw:
            raise ValueError("未提供 Introduction 文本：请选中文本或开启 auto_extract_intro")

    original_introduction = extract_clean_text(intro_raw)
    topic, paper_year = extract_topic_and_min_year(original_introduction)
    min_year = paper_year

    second_q = _clamp_openalex_query(f"{topic} review", max_words=8)
    paper_target = max(1, min(max_papers_for_llm, 200))
    pool, pool_meta = build_allowlisted_pool(
        topic=topic,
        min_publication_year=min_year,
        max_papers_for_llm=paper_target,
        second_pass_topic=second_q,
    )

    if len(pool) < paper_target:
        raise ValueError(
            f"在配置的顶刊白名单内未检索到足够带摘要的文献（{len(pool)}/{paper_target}；可能主题过窄或年份过滤过严）。"
            "可调整 Introduction 文本、补充 context，或稍后扩展 tier1_journals.json。"
        )

    parsed = _rewrite_intro_llm(original_introduction, pool, allowed_meta, context)
    remade = (parsed.get("remade_introduction") or "").strip()
    if not remade:
        raise ValueError("模型未返回有效的 remade_introduction")

    ok, errs = _validate_citations(remade, pool)
    if not ok:
        logger.warning(f"[IntroRemake] Citation validation failed: {errs}, retrying once")
        parsed = _rewrite_intro_llm(original_introduction, pool, allowed_meta, context)
        remade = (parsed.get("remade_introduction") or "").strip()
        ok2, errs2 = _validate_citations(remade, pool)
        if not ok2:
            raise ValueError(f"引用编号与文献池不一致: {errs2}")

    remade, cite_pool_order = remap_introduction_citations_pool_to_sequential(remade, pool)
    ok_seq, errs_seq = _validate_sequential_citations(remade, len(cite_pool_order))
    if not ok_seq:
        raise ValueError(f"引用顺序编号校验失败: {'; '.join(errs_seq)}")

    parsed_meta = _finalize_intro_metadata(
        remade,
        original_introduction,
        pool,
        allowed_meta,
        context,
        citation_pool_order=cite_pool_order,
    )
    refs_raw = parsed_meta.get("references") or []
    if not isinstance(refs_raw, list):
        refs_raw = []
    references = _enrich_references(refs_raw, pool)

    return {
        "allowed_journals": allowed_meta,
        "literature_pool": pool,
        "literature_pool_meta": pool_meta,
        "original_introduction": original_introduction,
        "remade_introduction": remade,
        "references": references,
        "continuity_notes": parsed_meta.get("continuity_notes") or "",
        "original_reference_audit": parsed_meta.get("original_reference_audit") or [],
        "search_topic": topic,
        "min_publication_year": min_year,
    }
