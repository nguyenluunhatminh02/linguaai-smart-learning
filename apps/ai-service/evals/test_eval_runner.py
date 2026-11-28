"""Deterministic tests for the AI eval runner (AI-05/TEST-13).

This pytest module exercises the eval runner without any live provider calls
or API keys. All tests use the built-in synthetic fixtures and deterministic
validation logic.

Run from apps/ai-service::

    python -m pytest evals/test_eval_runner.py -v
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Ensure the ai-service root is on sys.path for app imports.
_AI_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_SERVICE_ROOT))

from evals.run import (
    EXIT_BAD_CONFIG,
    EXIT_NO_LIVE_OPTIN,
    EXIT_PASS,
    Case,
    CheckResult,
    EvalConfigError,
    LiveOptInError,
    builtin_cases,
    load_cases,
    main,
    parse_case,
    run_checks,
    run_suite,
    validate_live_optin,
)


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def builtin_suite():
    """Load the built-in synthetic case suite once per module."""
    return load_cases()


@pytest.fixture(scope="module")
def first_case(builtin_suite):
    """Return the first case for focused tests."""
    return builtin_suite[0]


# ─────────────────────────────────────────────────────────────────────────────
# Test: builtin case generation
# ─────────────────────────────────────────────────────────────────────────────

def test_builtin_cases_returns_nonempty_tuple(builtin_suite):
    """The built-in suite must contain at least one case."""
    assert isinstance(builtin_suite, tuple)
    assert len(builtin_suite) > 0


def test_builtin_cases_raw_returns_dicts():
    """builtin_cases() returns dicts; load_cases() returns Case objects."""
    raw = builtin_cases()
    assert isinstance(raw, tuple)
    assert len(raw) > 0
    assert all(isinstance(c, dict) for c in raw)


def test_builtin_cases_are_stratified(builtin_suite):
    """Cases should span multiple features, languages, and levels."""
    features = {case.feature for case in builtin_suite}
    languages = {case.language for case in builtin_suite}
    levels = {case.level for case in builtin_suite}

    assert len(features) >= 3, "Suite should cover at least 3 features"
    assert len(languages) >= 3, "Suite should cover at least 3 languages"
    assert len(levels) >= 3, "Suite should cover at least 3 levels"


def test_builtin_cases_have_required_fields(builtin_suite):
    """Every case must have the required fields."""
    for case in builtin_suite:
        assert isinstance(case, Case)
        assert case.id
        assert case.feature
        assert case.language
        assert case.level
        assert case.source
        assert isinstance(case.input, dict)
        assert case.candidate is not None
        assert isinstance(case.expected, dict)
        assert case.prompt_version


def test_builtin_cases_have_valid_ids(builtin_suite):
    """Case IDs must be unique and follow the naming convention."""
    ids = [case.id for case in builtin_suite]
    assert len(ids) == len(set(ids)), "Case IDs must be unique"

    for case in builtin_suite:
        # IDs should follow: syn-<feature>-<language>-<level>-<seq>
        assert case.id.startswith("syn-"), f"ID {case.id} should start with 'syn-'"
        parts = case.id.split("-")
        assert len(parts) >= 5, f"ID {case.id} should have at least 5 parts"


def test_builtin_cases_have_expected_checks(builtin_suite):
    """Every case must declare expected checks."""
    for case in builtin_suite:
        expected = case.expected
        assert "mustDetect" in expected, f"Case {case.id} missing mustDetect"
        assert "mustNotClaim" in expected, f"Case {case.id} missing mustNotClaim"
        assert "schemaValid" in expected, f"Case {case.id} missing schemaValid"
        assert "rubric" in expected, f"Case {case.id} missing rubric"

        assert isinstance(expected["mustDetect"], list)
        assert isinstance(expected["mustNotClaim"], list)
        assert isinstance(expected["schemaValid"], bool)
        assert isinstance(expected["rubric"], dict)


# ─────────────────────────────────────────────────────────────────────────────
# Test: case parsing and validation
# ─────────────────────────────────────────────────────────────────────────────

def test_parse_case_accepts_valid_case(first_case):
    """parse_case should accept a valid case dict."""
    raw = {
        "id": first_case.id,
        "feature": first_case.feature,
        "language": first_case.language,
        "level": first_case.level,
        "source": first_case.source,
        "input": first_case.input,
        "candidate": first_case.candidate,
        "expected": first_case.expected,
        "prompt_version": first_case.prompt_version,
    }
    parsed = parse_case(raw)
    assert isinstance(parsed, Case)
    assert parsed.id == first_case.id


def test_parse_case_rejects_missing_fields():
    """parse_case should reject cases with missing required fields."""
    incomplete = {
        "id": "test-case-001",
        "feature": "writing_feedback",
        # Missing: language, level, source, input, candidate, expected, prompt_version
    }
    with pytest.raises(EvalConfigError, match="missing fields"):
        parse_case(incomplete)


def test_parse_case_rejects_invalid_language():
    """parse_case should reject unsupported languages."""
    raw = {
        "id": "test-case-001",
        "feature": "writing_feedback",
        "language": "klingon",  # Not in SUPPORTED_LANGUAGES
        "level": "A1",
        "source": "synthetic",
        "input": {"text": "test"},
        "candidate": {},
        "expected": {
            "mustDetect": [],
            "mustNotClaim": [],
            "schemaValid": True,
            "rubric": {"scale": "1-10", "minimum": {}},
        },
        "prompt_version": "writing.assess:v1",
    }
    with pytest.raises(EvalConfigError, match="unsupported language"):
        parse_case(raw)


def test_parse_case_rejects_invalid_level():
    """parse_case should reject unsupported CEFR levels."""
    raw = {
        "id": "test-case-001",
        "feature": "writing_feedback",
        "language": "english",
        "level": "X9",  # Not a valid CEFR level
        "source": "synthetic",
        "input": {"text": "test"},
        "candidate": {},
        "expected": {
            "mustDetect": [],
            "mustNotClaim": [],
            "schemaValid": True,
            "rubric": {"scale": "1-10", "minimum": {}},
        },
        "prompt_version": "writing.assess:v1",
    }
    with pytest.raises(EvalConfigError, match="unsupported level"):
        parse_case(raw)


def test_parse_case_rejects_malformed_prompt_version():
    """parse_case should reject prompt_version not matching '<id>:v<n>'."""
    raw = {
        "id": "test-case-001",
        "feature": "writing_feedback",
        "language": "english",
        "level": "A1",
        "source": "synthetic",
        "input": {"text": "test"},
        "candidate": {},
        "expected": {
            "mustDetect": [],
            "mustNotClaim": [],
            "schemaValid": True,
            "rubric": {"scale": "1-10", "minimum": {}},
        },
        "prompt_version": "invalid-format",  # Should be '<id>:v<n>'
    }
    with pytest.raises(EvalConfigError, match="prompt_version must be"):
        parse_case(raw)


# ─────────────────────────────────────────────────────────────────────────────
# Test: deterministic checks
# ─────────────────────────────────────────────────────────────────────────────

def test_run_checks_returns_list(first_case):
    """run_checks should return a list of CheckResult objects."""
    results = run_checks(first_case, first_case.candidate)
    assert isinstance(results, list)
    assert len(results) > 0
    for result in results:
        assert isinstance(result, CheckResult)
        assert isinstance(result.check, str)
        assert isinstance(result.passed, bool)


def test_run_checks_validates_schema(first_case):
    """run_checks should include a schema validation check."""
    results = run_checks(first_case, first_case.candidate)
    schema_checks = [r for r in results if r.check == "schema_valid"]
    assert len(schema_checks) > 0, "Should have at least one schema check"

    # The built-in candidate should pass schema validation
    schema_result = schema_checks[0]
    assert schema_result.passed is True, f"Schema check failed: {schema_result.detail}"


def test_run_checks_detects_must_detect_signals(first_case):
    """run_checks should verify mustDetect signals are present."""
    results = run_checks(first_case, first_case.candidate)
    detect_checks = [r for r in results if r.check == "must_detect"]
    assert len(detect_checks) > 0

    # Built-in cases should have their signals present
    detect_result = detect_checks[0]
    assert detect_result.passed is True, f"mustDetect failed: {detect_result.detail}"


def test_run_checks_enforces_must_not_claim(first_case):
    """run_checks should verify mustNotClaim phrases are absent."""
    results = run_checks(first_case, first_case.candidate)
    claim_checks = [r for r in results if r.check == "must_not_claim"]
    assert len(claim_checks) > 0

    # Built-in candidates should not contain forbidden claims
    claim_result = claim_checks[0]
    assert claim_result.passed is True, f"mustNotClaim failed: {claim_result.detail}"


def test_run_checks_validates_rubric_bounds(first_case):
    """run_checks should validate rubric score bounds."""
    results = run_checks(first_case, first_case.candidate)
    rubric_checks = [r for r in results if r.check == "rubric_bounds"]
    assert len(rubric_checks) > 0

    # Built-in candidates should have valid rubric scores
    rubric_result = rubric_checks[0]
    assert rubric_result.passed is True, f"Rubric check failed: {rubric_result.detail}"


def test_run_checks_detects_duplicates(builtin_suite):
    """run_checks should detect duplicate items in lists."""
    # Find a case with list fields (questions, cards, etc.)
    list_case = next(
        (c for c in builtin_suite if c.feature in {"reading_generation", "cards_generation", "quiz_generation"}),
        builtin_suite[0]
    )
    results = run_checks(list_case, list_case.candidate)
    dup_checks = [r for r in results if r.check == "no_duplicate_items"]
    assert len(dup_checks) > 0

    # Built-in fixtures should not have duplicates
    dup_result = dup_checks[0]
    assert dup_result.passed is True, f"Duplicate check failed: {dup_result.detail}"


# ─────────────────────────────────────────────────────────────────────────────
# Test: suite execution and reporting
# ─────────────────────────────────────────────────────────────────────────────

def test_run_suite_deterministic_mode(builtin_suite):
    """run_suite should execute in deterministic mode without network calls."""
    report = run_suite(builtin_suite[:5], mode="deterministic")

    assert isinstance(report, dict)
    assert report["schema_version"] == "ai-eval-report-v1"
    assert report["mode"] == "deterministic"
    assert "summary" in report
    assert "coverage" in report
    assert "results" in report

    summary = report["summary"]
    assert summary["total"] == 5
    assert summary["passed"] + summary["failed"] == summary["total"]
    assert 0 <= summary["failure_rate"] <= 1.0


def test_run_suite_coverage_report(builtin_suite):
    """run_suite should report coverage across features, languages, levels."""
    report = run_suite(builtin_suite, mode="deterministic")
    coverage = report["coverage"]

    assert "features" in coverage
    assert "languages" in coverage
    assert "levels" in coverage
    assert "sources" in coverage

    assert len(coverage["features"]) > 0
    assert len(coverage["languages"]) > 0
    assert len(coverage["levels"]) > 0


def test_run_suite_results_sorted(builtin_suite):
    """run_suite should sort results by case_id for stable output."""
    report = run_suite(builtin_suite[:10], mode="deterministic")
    results = report["results"]

    case_ids = [r["case_id"] for r in results]
    assert case_ids == sorted(case_ids), "Results should be sorted by case_id"


def test_run_suite_no_live_metadata_in_deterministic(builtin_suite):
    """Deterministic mode should not include live provider metadata."""
    report = run_suite(builtin_suite[:3], mode="deterministic")

    # In deterministic mode, run_metadata should have no models and zero latency
    run_meta = report["run_metadata"]
    assert run_meta["models"] == []
    assert run_meta["total_latency_ms"] == 0
    assert run_meta["usage_known"] is False
    assert run_meta["usage_totals"] == {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


def test_run_suite_handles_empty_suite():
    """run_suite should handle an empty case list gracefully."""
    report = run_suite([], mode="deterministic")

    assert report["summary"]["total"] == 0
    assert report["summary"]["passed"] == 0
    assert report["summary"]["failed"] == 0
    assert report["summary"]["failure_rate"] == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Test: case fingerprint stability
# ─────────────────────────────────────────────────────────────────────────────

def test_case_fingerprint_is_stable(first_case):
    """case_fingerprint should be deterministic for the same case."""
    fp1 = first_case.case_fingerprint()
    fp2 = first_case.case_fingerprint()
    assert fp1 == fp2
    assert len(fp1) == 16  # SHA-256 truncated to 16 hex chars


def test_case_fingerprint_changes_with_content(first_case):
    """case_fingerprint should change when case content changes."""
    fp_original = first_case.case_fingerprint()

    # Create a modified case
    modified_input = dict(first_case.input)
    modified_input["text"] = "modified text"
    modified_case = Case(
        id=first_case.id,
        feature=first_case.feature,
        language=first_case.language,
        level=first_case.level,
        source=first_case.source,
        input=modified_input,
        candidate=first_case.candidate,
        expected=first_case.expected,
        prompt_version=first_case.prompt_version,
        critical=first_case.critical,
        notes=first_case.notes,
    )
    fp_modified = modified_case.case_fingerprint()

    assert fp_original != fp_modified, "Fingerprint should change with content"


# ─────────────────────────────────────────────────────────────────────────────
# Test: JSONL case loading
# ─────────────────────────────────────────────────────────────────────────────

def test_load_cases_builtin(builtin_suite):
    """load_cases with no path should return built-in cases as Case objects."""
    cases = load_cases(None)
    assert len(cases) == len(builtin_suite)
    assert all(isinstance(c, Case) for c in cases)


def test_load_cases_rejects_missing_file():
    """load_cases should reject a non-existent file path."""
    with pytest.raises(EvalConfigError, match="not found"):
        load_cases(Path("/nonexistent/path/cases.jsonl"))


def test_load_cases_rejects_empty_file(tmp_path):
    """load_cases should reject an empty JSONL file."""
    empty_file = tmp_path / "empty.jsonl"
    empty_file.write_text("")

    with pytest.raises(EvalConfigError, match="dataset is empty"):
        load_cases(empty_file)


def test_load_cases_rejects_invalid_json(tmp_path):
    """load_cases should reject malformed JSON lines."""
    bad_file = tmp_path / "bad.jsonl"
    bad_file.write_text('{"id": "test"}\ninvalid json\n')

    with pytest.raises(EvalConfigError, match="invalid JSON"):
        load_cases(bad_file)


def test_load_cases_rejects_duplicate_ids(tmp_path, first_case):
    """load_cases should reject JSONL with duplicate case IDs."""
    dup_file = tmp_path / "dup.jsonl"
    case_dict = {
        "id": first_case.id,
        "feature": first_case.feature,
        "language": first_case.language,
        "level": first_case.level,
        "source": first_case.source,
        "input": first_case.input,
        "candidate": first_case.candidate,
        "expected": first_case.expected,
        "prompt_version": first_case.prompt_version,
    }
    dup_file.write_text(json.dumps(case_dict) + "\n" + json.dumps(case_dict) + "\n")

    with pytest.raises(EvalConfigError, match="duplicate case id"):
        load_cases(dup_file)


# ─────────────────────────────────────────────────────────────────────────────
# Test: CheckResult serialization
# ─────────────────────────────────────────────────────────────────────────────

def test_check_result_as_dict():
    """CheckResult.as_dict should return a serializable dict."""
    result = CheckResult(check="test_check", passed=True, detail="ok")
    d = result.as_dict()

    assert isinstance(d, dict)
    assert d["check"] == "test_check"
    assert d["passed"] is True
    assert d["detail"] == "ok"

    # Should be JSON-serializable
    json_str = json.dumps(d)
    assert json_str


def test_check_result_default_detail():
    """CheckResult should default detail to empty string."""
    result = CheckResult(check="test", passed=False)
    assert result.detail == ""


# ─────────────────────────────────────────────────────────────────────────────
# Test: integration with app schemas (no live calls)
# ─────────────────────────────────────────────────────────────────────────────

def test_builtin_candidates_pass_schema_validation(builtin_suite):
    """All built-in candidates should pass their feature's schema validation."""
    for case in builtin_suite[:10]:  # Test first 10 for speed
        results = run_checks(case, case.candidate)
        schema_checks = [r for r in results if r.check == "schema_valid"]
        assert len(schema_checks) > 0
        assert schema_checks[0].passed is True, (
            f"Case {case.id} failed schema validation: {schema_checks[0].detail}"
        )


def test_eval_runner_does_not_import_provider_client():
    """The eval runner should not import the provider client in deterministic mode."""
    # This test verifies that run_suite in deterministic mode doesn't trigger
    # provider imports. We check by ensuring no network-related modules are loaded.
    import sys

    # Clear any cached imports of provider-related modules
    provider_modules = [m for m in sys.modules if "groq" in m.lower() or "openai" in m.lower()]

    # Run a small suite (load_cases returns Case objects, required by run_suite)
    cases = load_cases()[:3]
    run_suite(cases, mode="deterministic")

    # Verify no new provider modules were imported
    new_provider_modules = [m for m in sys.modules if "groq" in m.lower() or "openai" in m.lower()]
    # Allow existing modules but no new ones
    assert len(new_provider_modules) == len(provider_modules), (
        "Deterministic mode should not import provider clients"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test: error handling
# ─────────────────────────────────────────────────────────────────────────────

def test_eval_config_error_is_value_error():
    """EvalConfigError should be a ValueError subclass."""
    assert issubclass(EvalConfigError, ValueError)


def test_parse_case_raises_eval_config_error_on_bad_input():
    """parse_case should raise EvalConfigError for invalid input."""
    with pytest.raises(EvalConfigError):
        parse_case({"id": "test"})  # Missing required fields


# ─────────────────────────────────────────────────────────────────────────────
# Test: feature coverage
# ─────────────────────────────────────────────────────────────────────────────

def test_builtin_suite_covers_all_features():
    """The built-in suite should cover all major features."""
    cases = load_cases()
    features = {case.feature for case in cases}

    expected_features = {
        "writing_feedback",
        "grammar",
        "reading_generation",
        "cards_generation",
        "quiz_generation",
        "nlp_analysis",
        "error_analysis",
        "chat",
    }

    # At least 6 of 8 features should be covered
    coverage = len(features & expected_features)
    assert coverage >= 6, f"Suite covers only {coverage}/8 features: {features}"


def test_builtin_suite_covers_multiple_languages():
    """The built-in suite should cover multiple languages."""
    cases = load_cases()
    languages = {case.language for case in cases}

    assert len(languages) >= 3, f"Suite covers only {len(languages)} languages"


def test_builtin_suite_covers_cefr_levels():
    """The built-in suite should cover multiple CEFR levels."""
    cases = load_cases()
    levels = {case.level for case in cases}

    cefr_levels = {"A1", "A2", "B1", "B2", "C1", "C2"}
    coverage = len(levels & cefr_levels)
    assert coverage >= 3, f"Suite covers only {coverage} CEFR levels: {levels}"


# ─────────────────────────────────────────────────────────────────────────────
# Test: CLI and live mode fail-closed behavior
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_live_optin_requires_cli_confirm():
    """validate_live_optin should fail without --live-confirm flag."""
    with pytest.raises(LiveOptInError, match="requires --live-confirm"):
        validate_live_optin(cli_confirm=False)


def test_validate_live_optin_requires_env_optin():
    """validate_live_optin should fail without LINGUAAI_EVAL_LIVE=1."""
    env = {"LINGUAAI_EVAL_LIVE": "0"}
    with pytest.raises(LiveOptInError, match="requires LINGUAAI_EVAL_LIVE=1"):
        validate_live_optin(cli_confirm=True, env=env)


def test_validate_live_optin_rejects_ci_environment():
    """validate_live_optin should fail in CI environments."""
    env = {"LINGUAAI_EVAL_LIVE": "1", "CI": "true"}
    with pytest.raises(LiveOptInError, match="disabled in CI"):
        validate_live_optin(cli_confirm=True, env=env)


def test_validate_live_optin_requires_confirmation_token():
    """validate_live_optin should require the confirmation token."""
    env = {"LINGUAAI_EVAL_LIVE": "1", "LINGUAAI_EVAL_LIVE_CONFIRM": "wrong-token"}
    with pytest.raises(LiveOptInError, match="confirmation token"):
        validate_live_optin(cli_confirm=True, env=env)


def test_validate_live_optin_passes_with_all_optins():
    """validate_live_optin should pass when all opt-ins are present."""
    env = {
        "LINGUAAI_EVAL_LIVE": "1",
        "LINGUAAI_EVAL_LIVE_CONFIRM": "I-UNDERSTAND-LIVE-EVAL-COSTS-MONEY",
    }
    validate_live_optin(cli_confirm=True, env=env)


def test_main_deterministic_mode_returns_success():
    """main() should return EXIT_PASS in deterministic mode."""
    exit_code = main(["--mode", "deterministic"])
    assert exit_code == EXIT_PASS


def test_main_rejects_live_confirm_in_deterministic_mode():
    """main() should reject --live-confirm when mode is deterministic."""
    exit_code = main(["--mode", "deterministic", "--live-confirm"])
    assert exit_code == EXIT_BAD_CONFIG


def test_main_rejects_model_in_deterministic_mode():
    """main() should reject --model when mode is deterministic."""
    exit_code = main(["--mode", "deterministic", "--model", "some-model"])
    assert exit_code == EXIT_BAD_CONFIG


def test_main_live_mode_requires_optin():
    """main() should fail in live mode without proper opt-ins."""
    env_patch = {k: v for k, v in os.environ.items() if not k.startswith("LINGUAAI_EVAL_LIVE")}
    with patch.dict(os.environ, env_patch, clear=True):
        exit_code = main(["--mode", "live"])
        assert exit_code == EXIT_NO_LIVE_OPTIN


def test_main_writes_report_json(tmp_path):
    """main() should write a JSON report when --report-json is specified."""
    report_path = tmp_path / "report.json"
    exit_code = main(["--mode", "deterministic", "--report-json", str(report_path)])

    assert exit_code == EXIT_PASS
    assert report_path.exists()

    report = json.loads(report_path.read_text())
    assert report["schema_version"] == "ai-eval-report-v1"
    assert report["mode"] == "deterministic"
    assert "summary" in report
    assert "results" in report


# ─────────────────────────────────────────────────────────────────────────────
# Test: security and containment
# ─────────────────────────────────────────────────────────────────────────────

def test_eval_runner_never_serializes_credentials():
    """The eval runner should never include credentials in a deterministic report."""
    report = run_suite(load_cases()[:3], mode="deterministic")
    report_str = json.dumps(report)

    assert "api_key" not in report_str.lower()
    assert "apikey" not in report_str.lower()
    assert "secret" not in report_str.lower()
    assert "password" not in report_str.lower()


def test_case_fingerprint_excludes_candidate():
    """case_fingerprint should not include the candidate (provider output)."""
    case = load_cases()[0]
    fp1 = case.case_fingerprint()

    modified_case = Case(
        id=case.id,
        feature=case.feature,
        language=case.language,
        level=case.level,
        source=case.source,
        input=case.input,
        candidate={"completely": "different"},
        expected=case.expected,
        prompt_version=case.prompt_version,
        critical=case.critical,
        notes=case.notes,
    )
    fp2 = modified_case.case_fingerprint()

    assert fp1 == fp2, "Fingerprint should not change with candidate"


def test_builtin_cases_are_synthetic():
    """All built-in cases should be marked as synthetic."""
    cases = load_cases()
    for case in cases:
        assert case.source == "synthetic", f"Case {case.id} should be synthetic"


def test_builtin_cases_have_notes():
    """All built-in cases should have notes explaining their provenance."""
    cases = load_cases()
    for case in cases:
        assert case.notes, f"Case {case.id} should have notes"
        assert "synthetic" in case.notes.lower() or "fixture" in case.notes.lower()
