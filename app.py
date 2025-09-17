#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Minimal changes to add:
- leader A/B highlight, controlled by GM checkboxes
- player: consequences still revealed only after a choice is resolved
Everything else preserved.
"""
from __future__ import annotations
import json, os, random, re, threading, time, socket
from pathlib import Path
from queue import SimpleQueue
from typing import Any, Dict, Iterable, List, Tuple

import yaml
from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__, static_folder="static", template_folder="templates")

# -----------------------------------------------------------------------------
# Global state
# -----------------------------------------------------------------------------
LOCK = threading.RLock()
STATE: Dict[str, Any] = {
    "title": "",
    "description": "",
    "choices": [],               # [{key,label,effects_text}]
    "resources": {},
    "resource_order": [],
    "bg_url": "",
    "bg_dim": 0.35,
    "blackout": False,
    "last_result_text": "",
    "last_choice_key": None,     # highlight on player view after resolve
    "show_timer": False,
    "timer_seconds": 0,
    "timer_running": False,
    "timer_ends_at": None,
    # NEW: which choice each leader highlights for preview on player
    "group_selected": {"A": None, "B": None},
}
SCENES: List[Dict[str, Any]] = []
CURRENT_SCENE_ID: str | None = None
SUBSCRIBERS: List[SimpleQueue] = []

SCENES_PATH_DEFAULT = Path("scenes.yaml")
PERSONALITIES_PATH = Path("personalities.yaml")
COCAPTAIN_COUNTS: Dict[str, int] = {}

RESOURCE_ALIASES = {
    "people": "population",
    "atsargos": "food",
    "population": "population",
    "food": "food",
    "morale": "morale",
    "infrastructure": "infrastructure",
}

# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------
def _now() -> float: return time.time()

def normalize_resource_key(k: str) -> str:
    k2 = (k or "").strip().lower()
    return RESOURCE_ALIASES.get(k2, k2)

DICE_TOKEN_RE = re.compile(r"([+\-]?\s*(?:\d+d\d+|\d+))", re.I)

def roll_expr(expr: Any) -> Tuple[int, str]:
    if isinstance(expr, (int, float)):
        v = int(expr); return v, f"{v:+d}"
    if not isinstance(expr, str): return 0, "+0"
    s = expr.replace("−", "-")
    tokens = [t.strip() for t in DICE_TOKEN_RE.findall(s.replace(" ", "")) if t.strip()]
    total, parts = 0, []
    for tok in tokens:
        sign = 1
        if tok[0] in "+-":
            sign = -1 if tok[0] == "-" else 1
            tok = tok[1:]
        if "d" in tok:
            n_str, s_str = tok.lower().split("d", 1)
            n = int(n_str) if n_str else 1
            sides = int(s_str)
            rolls = [random.randint(1, sides) for _ in range(max(0, n))]
            subtotal = sum(rolls) * sign
            total += subtotal
            parts.append((f"{subtotal:+d}", rolls, sides))
        else:
            val = int(tok) * sign
            total += val
            parts.append((f"{val:+d}", [], None))
    pretty = []
    for subtotal, rolls, sides in parts:
        pretty.append(f"{subtotal} (d{sides}:{'+'.join(map(str, rolls))})" if rolls else subtotal)
    return total, " ".join(pretty) if pretty else "+0"

def effects_to_text(effects: Dict[str, Any]) -> str:
    items = []
    for k, v in (effects or {}).items():
        rk = normalize_resource_key(k)
        if isinstance(v, (int, float)):
            val = f"{int(v):+d}"
        else:
            val = str(v).replace(" ", "")
            if not val.startswith(("+", "-")): val = "+" + val
        items.append(f"{val} {rk}")
    return ", ".join(items)

def apply_effects(effects: Dict[str, Any]) -> Tuple[Dict[str, int], str]:
    delta, parts = {}, []
    for k, v in (effects or {}).items():
        rk = normalize_resource_key(k)
        rolled, pretty = roll_expr(v)
        delta[rk] = delta.get(rk, 0) + rolled
        parts.append(f"{rk}: {pretty}")
    with LOCK:
        for rk, d in delta.items():
            STATE["resources"][rk] = max(0, int(STATE["resources"].get(rk, 0)) + d)
    return delta, "; ".join(parts)

def snapshot_state() -> Dict[str, Any]:
    with LOCK:
        st = dict(STATE)
        st["timer_ends_at"] = int(STATE["timer_ends_at"]) if STATE.get("timer_running") and STATE.get("timer_ends_at") else None
        return st

def broadcast():
    data = json.dumps(snapshot_state(), ensure_ascii=False)
    for q in list(SUBSCRIBERS):
        try: q.put(data)
        except Exception: pass

def set_resources(res: Dict[str, int], order: Iterable[str] | None = None):
    with LOCK:
        clean = {normalize_resource_key(k): int(v) for k, v in (res or {}).items()}
        STATE["resources"] = clean
        STATE["resource_order"] = [normalize_resource_key(x) for x in order] if order else list(clean.keys())

def set_current_scene(scene_id: str | None):
    global CURRENT_SCENE_ID
    with LOCK:
        CURRENT_SCENE_ID = scene_id
        STATE["last_result_text"] = ""
        STATE["last_choice_key"] = None
        # reset leader previews when switching scenes
        STATE["group_selected"] = {"A": None, "B": None}
        if scene_id is None:
            STATE["title"] = ""; STATE["description"] = ""; STATE["choices"] = []
        else:
            sc = next((s for s in SCENES if s.get("id") == scene_id), None)
            if sc:
                STATE["title"] = sc.get("title", "")
                STATE["description"] = sc.get("description", "")
                chs = []
                for c in sc.get("choices", []):
                    chs.append({"key": c.get("key"), "label": c.get("label",""), "effects_text": c.get("effects_text","")})
                STATE["choices"] = chs

# -----------------------------------------------------------------------------
# YAML
# -----------------------------------------------------------------------------
def load_scenes_from_file(path: Path) -> Tuple[Dict[str, int], List[Dict[str, Any]]]:
    if not path.exists(): raise FileNotFoundError(str(path))
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    resources = data.get("resources", {}) or {}
    scenes = data.get("scenes", []) or []
    for sc in scenes:
        for ch in sc.get("choices", []):
            eff = ch.get("effects", {}) or {}
            ch["effects_text"] = ch.get("effects_text") or effects_to_text(eff)
    return resources, scenes

def load_personalities() -> List[Dict[str, Any]]:
    if not PERSONALITIES_PATH.exists(): return []
    data = yaml.safe_load(PERSONALITIES_PATH.read_text(encoding="utf-8")) or {}
    plist = data.get("personalities", []) or []
    for p in plist:
        p["name"] = str(p.get("name",""))
        p["info"] = str(p.get("info",""))
        p["id"] = re.sub(r"[^a-z0-9_]+","_", p["name"].lower()).strip("_") or f"p_{abs(hash(p['name']))%10000}"
    return plist

# Keep personalities available (unchanged API)
import re
PERSONALITIES_CACHE = load_personalities()

# -----------------------------------------------------------------------------
# SSE
# -----------------------------------------------------------------------------
@app.get("/stream")
def stream():
    q = SimpleQueue(); SUBSCRIBERS.append(q)
    def gen():
        yield f"data: {json.dumps(snapshot_state(), ensure_ascii=False)}\n\n"
        try:
            while True: yield f"data: {q.get()}\n\n"
        finally:
            if q in SUBSCRIBERS: SUBSCRIBERS.remove(q)
    return Response(gen(), headers={
        "Content-Type":"text/event-stream","Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"
    })

# -----------------------------------------------------------------------------
# Pages
# -----------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("gm.html")

@app.get("/gm")
def page_gm():
    return render_template("gm.html")

@app.get("/player")
def page_player():
    return render_template("player.html")

@app.get("/assigner")
def page_assigner():
    return render_template("assigner.html")

# -----------------------------------------------------------------------------
# APIs
# -----------------------------------------------------------------------------
@app.post("/api/load_yaml")
def api_load_yaml():
    payload = request.get_json(force=True) or {}
    path = Path(payload.get("path") or SCENES_PATH_DEFAULT)
    try:
        resources, scenes = load_scenes_from_file(path)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})
    with LOCK:
        set_resources(resources, order=resources.keys())
        global SCENES
        SCENES = scenes
        set_current_scene(scenes[0]["id"] if scenes else None)
    broadcast(); return jsonify({"ok": True})

# NEW: upload scenes YAML directly from posted text
@app.post("/api/upload_yaml")
def api_upload_yaml():
    """Load scenes and resources from raw YAML string.

    Expects JSON payload with a "data" field containing the YAML content.
    """
    payload = request.get_json(force=True) or {}
    yaml_text = payload.get("data") or ""
    try:
        data = yaml.safe_load(yaml_text) or {}
        resources = data.get("resources", {}) or {}
        scenes = data.get("scenes", []) or []
        # compute effects_text for each choice
        for sc in scenes:
            for ch in sc.get("choices", []) or []:
                eff = ch.get("effects", {}) or {}
                ch["effects_text"] = ch.get("effects_text") or effects_to_text(eff)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})
    with LOCK:
        set_resources(resources, order=resources.keys())
        global SCENES
        SCENES = scenes
        set_current_scene(scenes[0]["id"] if scenes else None)
    broadcast(); return jsonify({"ok": True})

@app.get("/api/scenes")
def api_scenes():
    return jsonify({"scenes":[{"id":s.get("id"),"title":s.get("title","")} for s in SCENES]})

@app.post("/api/select_scene")
def api_select_scene():
    scene_id = (request.get_json(force=True) or {}).get("id")
    set_current_scene(scene_id); broadcast()
    return jsonify({"ok": True})

@app.get("/api/state")
def api_state(): return jsonify(snapshot_state())

@app.get("/api/resources")
def api_resources_get(): return jsonify({"resources": snapshot_state().get("resources", {})})

@app.post("/api/resources")
def api_resources_post():
    payload = request.get_json(force=True) or {}
    with LOCK:
        if "values" in payload:
            for k, v in (payload.get("values") or {}).items():
                rk = normalize_resource_key(k)
                STATE["resources"][rk] = max(0, int(v))
        if "delta" in payload:
            for k, d in (payload.get("delta") or {}).items():
                rk = normalize_resource_key(k)
                STATE["resources"][rk] = max(0, int(STATE["resources"].get(rk, 0)) + int(d))
    broadcast(); return jsonify({"ok": True})

@app.post("/api/choice")
def api_choice():
    payload = request.get_json(force=True) or {}
    key = payload.get("key")
    sc = next((s for s in SCENES if s.get("id") == CURRENT_SCENE_ID), None)
    if not sc: return jsonify({"ok": False, "error": "No current scene."}), 400
    choice = next((c for c in sc.get("choices", []) if c.get("key") == key), None)
    if not choice: return jsonify({"ok": False, "error": "Choice not found."}), 404
    delta, breakdown = apply_effects(choice.get("effects", {}))
    label = choice.get("label", "")
    signed = ", ".join([f"{rk} {d:+d}" for rk, d in delta.items()]) or "no change"
    with LOCK:
        STATE["last_result_text"] = f"Pasirinkta: {label}. Poveikis: {signed} ({breakdown})"
        STATE["last_choice_key"] = choice.get("key")
    broadcast(); return jsonify({"ok": True, "delta": delta})

# NEW: set leader A/B highlighted choice for player outline
@app.post("/api/leader_select")
def api_leader_select():
    payload = request.get_json(force=True) or {}
    leader = payload.get("leader")
    choice = payload.get("choice")
    with LOCK:
        if leader in ("A","B"):
            STATE["group_selected"][leader] = choice
    broadcast(); return jsonify({"ok": True})

# background / blackout / timer
@app.post("/api/background")
def api_background():
    payload = request.get_json(force=True) or {}
    with LOCK:
        STATE["bg_url"] = payload.get("url","")
        STATE["bg_dim"] = max(0.0, min(1.0, float(payload.get("dim", 0.35) or 0.35)))
    broadcast(); return jsonify({"ok": True})

@app.post("/api/blackout")
def api_blackout():
    payload = request.get_json(force=True) or {}
    with LOCK: STATE["blackout"] = bool(payload.get("value", False))
    broadcast(); return jsonify({"ok": True})

@app.post("/api/timer")
def api_timer():
    p = request.get_json(force=True) or {}
    action, show = p.get("action"), p.get("show")
    with LOCK:
        if show is not None: STATE["show_timer"] = bool(show)
        if action == "set":
            secs = max(0, int(p.get("seconds", 0) or 0))
            if STATE.get("timer_running"):
                STATE["timer_ends_at"] = _now() + secs
            else:
                STATE["timer_seconds"] = secs; STATE["timer_ends_at"] = None
        elif action == "start" and not STATE.get("timer_running"):
            STATE["timer_running"] = True
            STATE["timer_ends_at"] = _now() + max(0, int(STATE.get("timer_seconds",0) or 0))
        elif action == "stop" and STATE.get("timer_running"):
            remain = max(0, int(round(STATE["timer_ends_at"] - _now()))) if STATE.get("timer_ends_at") else 0
            STATE["timer_running"] = False; STATE["timer_seconds"] = remain; STATE["timer_ends_at"] = None
        elif action == "add":
            delta = int(p.get("delta", 0) or 0)
            if STATE.get("timer_running") and STATE.get("timer_ends_at"):
                STATE["timer_ends_at"] = max(_now(), STATE["timer_ends_at"] + delta)
            else:
                STATE["timer_seconds"] = max(0, int(STATE.get("timer_seconds", 0) or 0) + delta)
        elif action == "toggle_visibility":
            STATE["show_timer"] = not STATE.get("show_timer", False)
    broadcast(); return jsonify({"ok": True})

# personalities / assignment / co-captains (unchanged APIs)
@app.get("/api/personalities")
def api_personalities(): return jsonify(PERSONALITIES_CACHE)

@app.post("/api/assign_personalities")
def api_assign_personalities():
    names = [str(n).strip() for n in (request.get_json(force=True) or {}).get("names", []) if str(n).strip()]
    if not names: return jsonify({"error":"Pateik bent vieną vardą."}), 400
    roles = PERSONALITIES_CACHE[:]
    if not roles: return jsonify({"error":"Asmenybių sąrašas tuščias."}), 400
    random.shuffle(roles)
    assignments = []
    for i, n in enumerate(names):
        p = roles[i % len(roles)]
        assignments.append({"name": n, "personality": {"name": p["name"], "info": p["info"]}})
    counts = {n: int(COCAPTAIN_COUNTS.get(n, 0)) for n in names}
    return jsonify({"assignments": assignments, "counts": counts})

@app.get("/api/cocaptains")
def api_cocaptains_get(): return jsonify({"counts": COCAPTAIN_COUNTS})

@app.post("/api/cocaptain")
def api_cocaptain_bump():
    p = request.get_json(force=True) or {}
    name = str(p.get("name",""))
    delta = int(p.get("delta", 1))
    if not name: return jsonify({"error":"Trūksta vardo."}), 400
    COCAPTAIN_COUNTS[name] = max(0, int(COCAPTAIN_COUNTS.get(name, 0)) + delta)
    return jsonify({"ok": True, "name": name, "count": COCAPTAIN_COUNTS[name]})

# -----------------------------------------------------------------------------
# Bootstrap
# -----------------------------------------------------------------------------
def _initial_bootstrap():
    try:
        if SCENES_PATH_DEFAULT.exists():
            resources, scenes = load_scenes_from_file(SCENES_PATH_DEFAULT)
            set_resources(resources, order=resources.keys())
            global SCENES
            SCENES = scenes
            set_current_scene(scenes[0]["id"] if scenes else None)
        else:
            set_resources({"population":20,"food":20,"morale":20,"infrastructure":20})
            set_current_scene(None)
    except Exception as e:
        print("Initial load failed:", e)
_initial_bootstrap()

# -----------------------------------------------------------------------------
# Run
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    debug = bool(int(os.environ.get("DEBUG", "1")))
    local = f"http://127.0.0.1:{port}"
    ip = socket.gethostbyname(socket.gethostname())
    ip_url = f"http://{ip}:{port}"
    print("\n=== space-colony-larp-helper running ===")
    print(f"GM:        {local}/gm        | {ip_url}/gm")
    print(f"Player:    {local}/player    | {ip_url}/player")
    print(f"Assigner:  {local}/assigner  | {ip_url}/assigner")
    print(f"SSE:       {local}/stream    | {ip_url}/stream")
    print(f"State API: {local}/api/state | {ip_url}/api/state")
    print("Press Ctrl+C to stop.\n")
    app.run(host=host, port=port, debug=debug, threaded=True)
