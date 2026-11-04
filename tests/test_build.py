import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build  # noqa: E402


def row(ts="2026-01-01T10:00:00Z", sid="s1", inp=10, out=5, cw=0, cr=0,
        cost=0.1, model="m", line=1, tp=""):
    return {
        "ts": ts, "session_id": sid, "transcript_path": tp, "model": model,
        "line": line, "input_tokens": inp, "output_tokens": out,
        "cache_write_tokens": cw, "cache_read_tokens": cr,
        "estimated_cost_usd": cost,
    }


class BuildTests(unittest.TestCase):
    def test_first_baseline_and_delta(self):
        rows = [
            row("2026-01-01T10:00:00Z", inp=10, out=5, cost=0.1, line=1),
            row("2026-01-01T11:00:00Z", inp=30, out=15, cost=0.3, line=2),
        ]
        data = build.build(rows, {})
        self.assertEqual([e["kind"] for e in data["events"]], ["first-baseline", "delta"])
        self.assertAlmostEqual(data["events"][1]["in"], 20)
        self.assertAlmostEqual(data["events"][1]["cost"], 0.2)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["segmentTotal"], 0.3)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["latestTotal"], 0.3)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["diff"], 0)

    def test_reset_double_counts_segments(self):
        rows = [
            row("2026-01-01T10:00:00Z", inp=100, cost=1.0, line=1),
            row("2026-01-01T11:00:00Z", inp=10, cost=0.2, line=2),
        ]
        data = build.build(rows, {})
        self.assertEqual([e["kind"] for e in data["events"]], ["first-baseline", "reset-baseline"])
        self.assertEqual(data["meta"]["counts"]["resets"], 1)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["segmentTotal"], 1.2)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["latestTotal"], 0.2)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["diff"], 1.0)

    def test_cost_only_drop_is_anomaly_not_reset(self):
        rows = [
            row("2026-01-01T10:00:00Z", inp=10, cost=1.0, line=1),
            row("2026-01-01T11:00:00Z", inp=20, cost=0.5, line=2),
        ]
        data = build.build(rows, {})
        self.assertEqual([e["kind"] for e in data["events"]], ["first-baseline", "anomaly"])
        self.assertEqual(data["meta"]["counts"]["resets"], 0)
        self.assertEqual(data["meta"]["counts"]["anomalies"], 1)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["segmentTotal"], 1.0)
        self.assertAlmostEqual(data["meta"]["reconciliation"]["latestTotal"], 0.5)

    def test_duplicate_rows_are_skipped(self):
        r = row("2026-01-01T10:00:00Z", inp=10, cost=0.1, line=1)
        r2 = dict(r, line=2)
        data = build.build([r, r2], {})
        self.assertEqual(data["meta"]["counts"]["duplicateRows"], 1)
        self.assertEqual(len(data["events"]), 1)

    def test_same_timestamp_different_values_flagged(self):
        rows = [
            row("2026-01-01T10:00:00Z", inp=10, cost=0.1, line=1),
            row("2026-01-01T10:00:00Z", inp=20, cost=0.2, line=2),
        ]
        data = build.build(rows, {})
        self.assertEqual(data["meta"]["counts"]["anomalies"], 1)
        self.assertEqual(len(data["events"]), 2)

    def test_cross_model_attribution(self):
        rows = [
            row("2026-01-01T10:00:00Z", inp=10, cost=0.1, model="model-a", line=1),
            row("2026-01-01T11:00:00Z", inp=20, cost=0.3, model="model-b", line=2),
        ]
        data = build.build(rows, {})
        ev = data["events"][1]
        self.assertEqual(ev["modelFrom"], "model-a")
        self.assertEqual(ev["modelTo"], "model-b")
        self.assertEqual(data["meta"]["counts"]["crossModelDeltas"], 1)

    def test_metadata_and_models(self):
        rows = [row("2026-01-01T10:00:00Z", model="provider/model-x", line=1)]
        meta = {"s1": {"cwd": "/Users/example/project", "title": "hello"}}
        data = build.build(rows, meta)
        session = data["sessions"][0]
        self.assertEqual(session["project"], "project")
        self.assertEqual(session["title"], "hello")
        self.assertEqual(session["modelsDisplay"], ["model-x"])
        self.assertEqual(data["events"][0]["priceClass"], "fallback-sonnet")

    def test_load_rows_skips_bad_and_coerces_missing(self):
        lines = [
            json.dumps({"timestamp": "2026-01-01T10:00:00Z", "session_id": "s1",
                        "input_tokens": 10, "output_tokens": 5,
                        "cache_write_tokens": 0, "cache_read_tokens": 0,
                        "estimated_cost_usd": 0.1}),
            "{not json",
            json.dumps({"timestamp": "bad", "session_id": "s1"}),
            json.dumps({"timestamp": "2026-01-01T11:00:00Z", "session_id": "s1",
                        "input_tokens": 1}),
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as fh:
            fh.write("\n".join(lines))
            path = fh.name
        try:
            rows, counts = build.load_rows(path)
        finally:
            Path(path).unlink()
        self.assertEqual(len(rows), 2)
        self.assertEqual(counts["skippedRows"], 2)
        self.assertEqual(counts["coercedRows"], 1)

    def test_render_escapes_script_close(self):
        data = {"meta": {}, "sessions": [{"title": "</script><b>x</b>"}], "events": []}
        html = build.render("<script>__COST_DATA_JSON__</script>", data)
        self.assertNotIn("</script><b>x</b>", html)
        self.assertIn("<\\/script>", html)


if __name__ == "__main__":
    unittest.main()
