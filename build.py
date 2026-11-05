#!/usr/bin/env python3
"""Build a single-file Claude Code cost board.

Reads ~/.claude/metrics/costs.jsonl (cumulative per-session snapshots), derives
typed events, and injects the result into template.html -> cost-board.html.

Only the Python standard library is used.
"""

import argparse
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_write_tokens",
    "cache_read_tokens",
)
NUM_KEYS = TOKEN_KEYS + ("estimated_cost_usd",)
HOME = Path.home()
DEFAULT_COSTS = HOME / ".claude" / "metrics" / "costs.jsonl"
DEFAULT_PROJECTS = HOME / ".claude" / "projects"
ROOT = Path(__file__).resolve().parent
DATA_PLACEHOLDER = "__COST_DATA_JSON__"
PRICING_PLACEHOLDER = "__PRICING_JS__"
DEFAULT_PRICING = ROOT / "pricing.js"


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_ts(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def display_model(raw):
    """Provider prefixes (e.g. hk-h20-.../model) share the same display name."""
    return str(raw or "unknown").split("/")[-1].strip().lower() or "unknown"


def price_class(raw):
    """Mirror ECC's approximate rate lookup so the UI can flag fallbacks."""
    m = display_model(raw)
    if "fable" in m or "mythos" in m:
        return "fable"
    if "haiku" in m:
        return "haiku"
    if re.search(r"(?:^|[^a-z0-9])sonnet-5(?:[^a-z0-9]|$)", m):
        return "sonnet5"
    if re.search(r"3-opus|opus-4-0(?!\d)|opus-4-1(?!\d)|opus-4[-@]\d{8}", m):
        return "opus-legacy"
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    return "fallback-sonnet"


def clean_title(text):
    if not isinstance(text, str):
        return ""
    text = re.sub(r"<[^>]{0,200}>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:80]


def load_rows(path):
    counts = {
        "totalLines": 0,
        "skippedRows": 0,
        "coercedRows": 0,
    }
    rows = []
    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except OSError as exc:
        raise SystemExit("cannot read %s: %s" % (path, exc))
    with fh:
        for lineno, line in enumerate(fh, 1):
            counts["totalLines"] += 1
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except (ValueError, TypeError):
                counts["skippedRows"] += 1
                continue
            if not isinstance(d, dict):
                counts["skippedRows"] += 1
                continue
            ts = d.get("timestamp")
            sid = d.get("session_id")
            if parse_ts(ts) is None or not isinstance(sid, str) or not sid:
                counts["skippedRows"] += 1
                continue

            missing = False
            values = {}
            bad = False
            for key in NUM_KEYS:
                raw = d.get(key)
                if raw is None:
                    raw = 0
                    missing = True
                if isinstance(raw, bool):
                    bad = True
                    break
                try:
                    num = float(raw)
                except (TypeError, ValueError):
                    bad = True
                    break
                if not math.isfinite(num) or num < 0:
                    bad = True
                    break
                values[key] = num
            if bad:
                counts["skippedRows"] += 1
                continue
            if missing:
                counts["coercedRows"] += 1

            rows.append({
                "ts": ts,
                "session_id": sid,
                "transcript_path": d.get("transcript_path") or "",
                "model": d.get("model") or "unknown",
                "line": lineno,
                "input_tokens": int(round(values["input_tokens"])),
                "output_tokens": int(round(values["output_tokens"])),
                "cache_write_tokens": int(round(values["cache_write_tokens"])),
                "cache_read_tokens": int(round(values["cache_read_tokens"])),
                "estimated_cost_usd": values["estimated_cost_usd"],
            })
    counts["rows"] = len(rows)
    return rows, counts


def load_transcript_meta(projects_dir, limit_lines=400):
    """Map session id -> {cwd, title} using the first few transcript lines."""
    meta = {}
    if not projects_dir or not Path(projects_dir).is_dir():
        return meta
    for path in Path(projects_dir).glob("*/*.jsonl"):
        sid = path.stem
        cwd = None
        title = None
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for idx, line in enumerate(fh):
                    if idx >= limit_lines and cwd and title:
                        break
                    try:
                        d = json.loads(line)
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(d, dict):
                        continue
                    if cwd is None and isinstance(d.get("cwd"), str):
                        cwd = d["cwd"]
                    if title is None and d.get("type") == "user":
                        message = d.get("message") or {}
                        content = message.get("content")
                        text = ""
                        if isinstance(content, str):
                            text = content
                        elif isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "text":
                                    text = block.get("text", "")
                                    break
                        text = clean_title(text)
                        if text:
                            title = text
                    if cwd and title:
                        break
        except OSError:
            pass
        if cwd or title:
            meta[sid] = {"cwd": cwd, "title": title}
    return meta


def encode_cwd(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path or "")


def project_label(cwd):
    if not cwd:
        return ""
    return Path(cwd).name or cwd


def infer_project(transcript_path, known):
    folder = Path(transcript_path).parent.name if transcript_path else ""
    if folder and folder in known:
        cwd = known[folder]
        return project_label(cwd), cwd, False
    raw = folder.lstrip("-").replace("-", "/")
    parts = [p for p in raw.split("/") if p]
    if not parts:
        return "未知项目", "", True
    label = " / ".join(parts[-2:]) if len(parts) >= 2 else parts[-1]
    return label, "", True


def rows_equal(a, b):
    if a["ts"] != b["ts"] or a["model"] != b["model"]:
        return False
    return all(a[k] == b[k] for k in NUM_KEYS)


def build(rows, meta, source_path=None, source_mtime=None, generated_at=None):
    counts = {
        "rows": len(rows),
        "validRows": len(rows),
        "skippedRows": 0,
        "coercedRows": 0,
        "duplicateRows": 0,
        "anomalies": 0,
        "resets": 0,
        "crossModelDeltas": 0,
        "inferredProjects": 0,
        "missingTranscripts": 0,
        "sessions": 0,
        "segments": 0,
    }
    known = {}
    for entry in meta.values():
        cwd = entry.get("cwd")
        if cwd:
            known[encode_cwd(cwd)] = cwd

    by_session = defaultdict(list)
    for row in rows:
        by_session[row["session_id"]].append(row)

    sessions = []
    events = []
    seq = 0
    latest_total = 0.0
    baseline_total = 0.0

    for sid in sorted(by_session):
        session_rows = by_session[sid]
        session_rows.sort(key=lambda r: (parse_ts(r["ts"]), r["line"]))
        segments = []
        session_events = []
        prev = None
        seg_id = -1
        last_row = None

        for row in session_rows:
            if prev is not None and rows_equal(prev, row):
                counts["duplicateRows"] += 1
                last_row = row
                continue

            gap_hours = 0.0
            if prev is not None:
                gap_hours = max(0.0, (parse_ts(row["ts"]) - parse_ts(prev["ts"])).total_seconds() / 3600.0)

            if prev is None:
                seg_id = 0
                kind = "first-baseline"
                values = {k: row[k] for k in TOKEN_KEYS}
                cost = row["estimated_cost_usd"]
                segments.append({
                    "id": seg_id,
                    "startTs": row["ts"],
                    "endTs": row["ts"],
                    "kind": "first",
                    "total": 0.0,
                })
            else:
                token_delta = {k: row[k] - prev[k] for k in TOKEN_KEYS}
                cost_delta = row["estimated_cost_usd"] - prev["estimated_cost_usd"]
                if any(v < 0 for v in token_delta.values()):
                    seg_id += 1
                    kind = "reset-baseline"
                    values = {k: row[k] for k in TOKEN_KEYS}
                    cost = row["estimated_cost_usd"]
                    segments.append({
                        "id": seg_id,
                        "startTs": row["ts"],
                        "endTs": row["ts"],
                        "kind": "reset",
                        "total": 0.0,
                    })
                    counts["resets"] += 1
                else:
                    values = token_delta
                    if cost_delta < 0:
                        # Token counters grew, only the ECC cost estimate fell
                        # (model/price change or recalculation). Clamp instead of
                        # inventing a negative event.
                        kind = "anomaly"
                        cost = 0.0
                        counts["anomalies"] += 1
                    else:
                        kind = "delta"
                        cost = cost_delta
                        if row["ts"] == prev["ts"]:
                            counts["anomalies"] += 1

            model_from = prev["model"] if prev else None
            model_to = row["model"]
            if prev is not None and model_from != model_to:
                counts["crossModelDeltas"] += 1

            if kind in ("first-baseline", "reset-baseline"):
                ts_conf = "low"
                baseline_total += cost
            else:
                ts_conf = "low" if gap_hours > 12 else "high"

            event = {
                "seq": seq,
                "ts": row["ts"],
                "session": sid,
                "segment": seg_id,
                "kind": kind,
                "tsConfidence": ts_conf,
                "gapHours": round(gap_hours, 3),
                "modelFrom": model_from,
                "modelTo": model_to,
                "modelRaw": model_to,
                "modelDisplay": display_model(model_to),
                "priceClass": price_class(model_to),
                "in": values["input_tokens"],
                "out": values["output_tokens"],
                "cacheWrite": values["cache_write_tokens"],
                "cacheRead": values["cache_read_tokens"],
                "cost": cost,
            }
            seq += 1
            events.append(event)
            session_events.append(event)
            segments[-1]["endTs"] = row["ts"]
            segments[-1]["total"] += cost
            prev = row
            last_row = row

        if not session_events:
            continue

        sid_meta = meta.get(sid) or {}
        cwd = sid_meta.get("cwd")
        title = clean_title(sid_meta.get("title"))
        if cwd:
            project, project_path, inferred = project_label(cwd), cwd, False
        else:
            project, project_path, inferred = infer_project(
                session_rows[0].get("transcript_path"),
                known,
            )
        if inferred:
            counts["inferredProjects"] += 1
        transcript_path = session_rows[0].get("transcript_path") or ""
        if not transcript_path or not Path(transcript_path).exists():
            counts["missingTranscripts"] += 1

        session_latest = last_row["estimated_cost_usd"] if last_row else 0.0
        session_seg_total = sum(e["cost"] for e in session_events)
        latest_total += session_latest

        sessions.append({
            "id": sid,
            "project": project or "未知项目",
            "projectPath": project_path,
            "projectInferred": inferred,
            "title": title or sid[:8],
            "modelsRaw": sorted({e["modelRaw"] for e in session_events}),
            "modelsDisplay": sorted({e["modelDisplay"] for e in session_events}),
            "firstTs": session_rows[0]["ts"],
            "lastTs": session_rows[-1]["ts"],
            "latestTotal": session_latest,
            "segmentTotal": session_seg_total,
            "lastSegment": segments[-1]["id"],
            "transcriptPath": transcript_path,
            "transcriptExists": bool(transcript_path and Path(transcript_path).exists()),
            "segments": segments,
            "eventCount": len(session_events),
        })
        counts["segments"] += len(segments)

    events.sort(key=lambda e: (parse_ts(e["ts"]), e["seq"]))
    counts["sessions"] = len(sessions)
    segment_total = sum(e["cost"] for e in events)
    diff = segment_total - latest_total
    coverage = {}
    if events:
        coverage = {"firstTs": events[0]["ts"], "lastTs": events[-1]["ts"]}

    fingerprint = ""
    if source_path and Path(source_path).exists():
        h = hashlib.sha256()
        with open(source_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        fingerprint = "sha256:" + h.hexdigest()

    return {
        "meta": {
            "generatedAt": generated_at or now_iso(),
            "tz": "local",
            "source": {
                "path": str(source_path) if source_path else "",
                "mtime": source_mtime,
                "fingerprint": fingerprint,
            },
            "coverage": coverage,
            "counts": counts,
            "reconciliation": {
                "latestTotal": round(latest_total, 6),
                "segmentTotal": round(segment_total, 6),
                "diff": round(diff, 6),
                "baselineTotal": round(baseline_total, 6),
                "baselineShare": round(baseline_total / segment_total, 6) if segment_total else 0,
                "lowConfidenceEvents": sum(1 for e in events if e["tsConfidence"] == "low"),
            },
        },
        "sessions": sessions,
        "events": events,
    }


def render(template_text, data, pricing_source):
    if template_text.count(DATA_PLACEHOLDER) != 1:
        raise SystemExit("template must contain exactly one %s" % DATA_PLACEHOLDER)
    if template_text.count(PRICING_PLACEHOLDER) != 1:
        raise SystemExit("template must contain exactly one %s" % PRICING_PLACEHOLDER)
    if "</script" in pricing_source.lower():
        raise SystemExit("pricing source must not contain </script")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # Prevent a session title containing </script> from terminating the block.
    payload = payload.replace("</", "<\\/")
    return template_text.replace(PRICING_PLACEHOLDER, pricing_source).replace(
        DATA_PLACEHOLDER, payload
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the single-file Claude Code cost board.")
    parser.add_argument("--costs", default=str(DEFAULT_COSTS), help="path to costs.jsonl")
    parser.add_argument("--projects", default=str(DEFAULT_PROJECTS), help="path to ~/.claude/projects")
    parser.add_argument("--template", default=str(ROOT / "template.html"), help="HTML template")
    parser.add_argument("--pricing", default=str(DEFAULT_PRICING), help="pricing module")
    parser.add_argument("--out", default=str(ROOT / "cost-board.html"), help="output HTML")
    parser.add_argument("--data-out", default=str(ROOT / "data.snapshot.json"), help="optional JSON snapshot")
    parser.add_argument("--no-transcripts", action="store_true", help="skip reading transcript metadata")
    args = parser.parse_args(argv)

    costs_path = Path(args.costs).expanduser()
    if not costs_path.exists():
        raise SystemExit("costs file not found: %s" % costs_path)

    rows, load_counts = load_rows(costs_path)
    meta = {}
    if not args.no_transcripts:
        meta = load_transcript_meta(Path(args.projects).expanduser())

    stat = costs_path.stat()
    data = build(
        rows,
        meta,
        source_path=costs_path,
        source_mtime=datetime.fromtimestamp(stat.st_mtime, timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    )
    data["meta"]["counts"].update({
        "skippedRows": load_counts["skippedRows"],
        "coercedRows": load_counts["coercedRows"],
        "totalLines": load_counts["totalLines"],
    })

    template_text = Path(args.template).read_text(encoding="utf-8")
    pricing_source = Path(args.pricing).read_text(encoding="utf-8")
    html = render(template_text, data, pricing_source)
    Path(args.out).write_text(html, encoding="utf-8")
    if args.data_out:
        Path(args.data_out).write_text(
            json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
        )

    rec = data["meta"]["reconciliation"]
    counts = data["meta"]["counts"]
    print("wrote %s (%.1f KB)" % (args.out, Path(args.out).stat().st_size / 1024.0))
    print(
        "sessions=%d events=%d segments=%d rows=%d skipped=%d duplicates=%d resets=%d anomalies=%d"
        % (
            counts["sessions"],
            len(data["events"]),
            counts["segments"],
            counts["validRows"],
            counts["skippedRows"],
            counts["duplicateRows"],
            counts["resets"],
            counts["anomalies"],
        )
    )
    print(
        "segmentTotal=$%.2f latestTotal=$%.2f diff=$%.2f baseline=$%.2f (%.1f%%)"
        % (
            rec["segmentTotal"],
            rec["latestTotal"],
            rec["diff"],
            rec["baselineTotal"],
            rec["baselineShare"] * 100,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
