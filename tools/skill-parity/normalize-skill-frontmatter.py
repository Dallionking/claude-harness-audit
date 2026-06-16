#!/usr/bin/env python3
"""
normalize-skill-frontmatter.py — make SKILL.md frontmatter STRICTLY-VALID YAML.

Codex's Rust YAML parser (codex_core) is strict; Claude's is lenient. Claude skills
ship frontmatter Claude tolerates but Codex rejects:
  - double-quoted descriptions containing \\' (invalid YAML escape) → unknown escape char
  - unquoted descriptions containing ': ' (colon-space)            → mapping values not allowed
  - missing '---' frontmatter delimiters                            → missing frontmatter

This leniently extracts the frontmatter pairs and RE-EMITS them through PyYAML
(valid-by-construction). Values round-trip to the SAME strings; only encoding changes.
Missing frontmatter is synthesized (name=dir, description=first prose line). Idempotent.

Usage:
  python3 normalize-skill-frontmatter.py --check <dir>
  python3 normalize-skill-frontmatter.py --apply <dir> [stamp]
"""
import sys, os, re, glob, shutil
try:
    import yaml
except ImportError:
    print("FATAL: PyYAML not available"); sys.exit(3)

def strip_quotes(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        inner = v[1:-1]
        inner = inner.replace("\\'", "'").replace('\\"', '"') if v[0] == '"' else inner.replace("''", "'")
        return inner
    return v

def parse_frontmatter(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None, text
    fm, body = lines[1:end], "\n".join(lines[end+1:])
    pairs, cur = [], None
    for ln in fm:
        if re.match(r"^\s*-\s+", ln) and cur is not None and pairs:
            item = strip_quotes(re.sub(r"^\s*-\s+", "", ln))
            if not isinstance(pairs[-1][1], list):
                pairs[-1] = (pairs[-1][0], [] if pairs[-1][1] == "" else [pairs[-1][1]])
            pairs[-1][1].append(item)
            continue
        m = re.match(r"^([A-Za-z_][\w-]*):\s?(.*)$", ln)
        if m:
            cur = m.group(1)
            pairs.append((cur, strip_quotes(m.group(2)) if m.group(2).strip() else ""))
        elif pairs and isinstance(pairs[-1][1], str) and ln.strip():
            pairs[-1] = (pairs[-1][0], (pairs[-1][1] + " " + strip_quotes(ln)).strip())
    return pairs, body

def emit_inner(pairs):
    d = {}
    for k, v in pairs:
        d[k] = v                                   # last-wins on dup keys (rare, malformed)
    return yaml.safe_dump(d, sort_keys=False, default_flow_style=False,
                          allow_unicode=True, width=10**9)

def valid(inner):
    try:
        yaml.safe_load(inner); return True
    except Exception:
        return False

def synth_desc(body):
    for ln in body.split("\n"):
        s = ln.strip()
        if s and not s.startswith("#") and not s.startswith("---"):
            return re.sub(r"\s+", " ", s)[:400]
    return "Skill."

def clamp_desc(s, n=1024):
    """Codex enforces description <= 1024 chars. Trim at a clean boundary."""
    if not isinstance(s, str) or len(s) <= n:
        return s, False
    cut = s[:n]
    for sep in (". ", "! ", "? ", "; ", " "):
        i = cut.rfind(sep)
        if i > n * 0.6:
            return cut[: i + (0 if sep == " " else 1)].rstrip(), True
    return cut.rstrip(), True

def process(path, apply, stamp):
    text = open(path, encoding="utf-8").read()
    name = os.path.basename(os.path.dirname(path))
    pairs, body = parse_frontmatter(text)
    if pairs is None:                              # no frontmatter → synthesize
        status = "SYNTHESIZED"
        pairs = [("name", name), ("description", synth_desc(text))]
        body = text
    else:
        orig_inner = text.split("---", 2)[1] if text.count("---") >= 2 else ""
        was_valid = valid(orig_inner)
        if {k for k, _ in pairs} and "name" not in {k for k, _ in pairs}:
            pairs.insert(0, ("name", name))
        status = "ALREADY_OK" if was_valid else "FIXED"
    # clamp over-length descriptions (Codex enforces <= 1024) — even on valid files
    clamped = False
    for idx, (k, v) in enumerate(pairs):
        if k == "description":
            nv, did = clamp_desc(v)
            if did:
                pairs[idx] = (k, nv); clamped = True
    if status == "ALREADY_OK" and not clamped:
        return ("ALREADY_OK", name)               # valid + within length → never touch
    inner = emit_inner(pairs)
    if not valid(inner):
        return ("STILL_INVALID", name)
    new_text = "---\n" + inner + "---\n" + (("\n" + body) if body and not body.startswith("\n") else body)
    if apply:
        bdir = os.path.join(os.path.expanduser("~/.coding-harness/skill-vault/_archive"),
                            "frontmatter-normalize-" + stamp)
        os.makedirs(bdir, exist_ok=True)
        shutil.copy2(path, os.path.join(bdir, name + ".SKILL.md.orig"))
        open(path, "w", encoding="utf-8").write(new_text)
    if status == "ALREADY_OK" and clamped:
        status = "CLAMPED"
    return (status, name)

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "--check"
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/.claude/skills")
    stamp = sys.argv[3] if len(sys.argv) > 3 else "manual"
    apply = (mode == "--apply")
    buckets = {}
    for skill in sorted(glob.glob(os.path.join(root, "*", "SKILL.md"))):
        st, nm = process(skill, apply, stamp)
        buckets.setdefault(st, []).append(nm)
    for st in ("FIXED", "CLAMPED", "SYNTHESIZED", "STILL_INVALID", "ALREADY_OK"):
        names = buckets.get(st, [])
        if not names: continue
        show = "" if st == "ALREADY_OK" else " :: " + " ".join(names[:40])
        print(f"{st}: {len(names)}{show}")
