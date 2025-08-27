from flask import Flask, request, Response, jsonify, render_template, send_from_directory
import json, time, threading, queue, os, random, yaml
from typing import Any, Dict, Optional, Tuple

app = Flask(__name__, static_url_path="/static", static_folder="static", template_folder="templates")

# ---------- Shared state & SSE ----------
state_lock = threading.Lock()
subscribers = set()  # set[queue.Queue]

def now() -> float: return time.time()

state = {
    # Scene shown to Player
    "title": "Welcome",
    "description": "Load a YAML file on the GM panel to begin.",
    "choices": [],                # list[{key,label,effects_text}]
    "current_scene_id": None,

    # Resources & order
    "resources": {},
    "resource_order": [],

    # Visuals
    "blackout": False,
    "bg_url": "",
    "bg_dim": 0.35,

    # Timer
    "show_timer": False,
    "timer_seconds": 180,
    "timer_ends_at": None,

    # Result line after a choice
    "last_result_text": "",
}

SCENES_PATH_DEFAULT = "scenes.yaml"
scenes_data = { "resources": {}, "scenes": [], "index_by_id": {} }

def _serialize_state() -> str: return json.dumps(state)

def publish_locked():
    data = _serialize_state()
    dead = []
    for q in list(subscribers):
        try: q.put_nowait(data)
        except Exception: dead.append(q)
    for q in dead: subscribers.discard(q)

# ---------- Dice parsing ----------
def parse_and_roll_effect(value: Any) -> Tuple[int, Optional[str]]:
    """Supports ints and dice strings like +1d6, -2d4, 3d8, or 2d6+3."""
    if isinstance(value, int):
        return value, None
    if isinstance(value, str) and value.strip().lstrip("+-").isdigit():
        return int(value.strip()), None
    if isinstance(value, str):
        import re
        # Updated regex to support optional modifier (+C or -C)
        m = re.fullmatch(r'([+-]?)(\d+)[dD](\d+)([+-]\d+)?', value.strip())
        if m:
            sign, n, sides, modifier = m.groups()
            n, sides = int(n), int(sides)
            if n <= 0 or sides <= 0:
                return 0, None
            total = sum(random.randint(1, sides) for _ in range(n))
            if modifier:
                total += int(modifier)
            if sign == "-":
                total = -total
            disp = (sign if sign in "+-" else "+") + f"{n}d{sides}"
            if modifier:
                disp += modifier
            return total, disp
    return 0, None

def format_effects_list_for_display(effects: Dict[str, Any]) -> str:
    """Human text like '+1d6 food, -2d4 morale' (no rolling yet)."""
    parts, order, seen = [], (state.get("resource_order") or list(effects.keys())), set()
    for name in order:
        if name in effects:
            seen.add(name)
            val = effects[name]
            if isinstance(val, int):
                parts.append(f"{'+' if val>=0 else ''}{val} {name}")
            elif isinstance(val, str):
                s = val.strip()
                if s and s[0] not in "+-": s = "+" + s
                parts.append(f"{s} {name}")
    for name, val in effects.items():
        if name in seen: continue
        if isinstance(val, int):
            parts.append(f"{'+' if val>=0 else ''}{val} {name}")
        elif isinstance(val, str):
            s = val.strip()
            if s and s[0] not in "+-": s = "+" + s
            parts.append(f"{s} {name}")
    return ", ".join(parts)

def summarize_applied_effects(applied: Dict[str, int]) -> str:
    if not applied: return ""
    parts, order, used = [], (state.get("resource_order") or list(applied.keys())), set()
    for name in order:
        if name in applied:
            used.add(name)
            d = applied[name]
            parts.append(f"{name.capitalize()} {'+' if d>=0 else ''}{d}")
    for name, d in applied.items():
        if name not in used: parts.append(f"{name.capitalize()} {'+' if d>=0 else ''}{d}")
    return ", ".join(parts)

# ---------- Scenes ----------
def load_scenes_from_path(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    resources = data.get("resources", {}) or {}
    scenes = data.get("scenes", []) or {}
    index = {s.get("id"): s for s in scenes if s.get("id")}
    return {"resources": resources, "scenes": scenes, "index_by_id": index}

def _apply_scene_to_state(scene: Dict[str, Any]):
    state["title"] = scene.get("title", "") or ""
    state["description"] = scene.get("description", "") or ""
    out = []
    for c in (scene.get("choices") or []):
        eff = c.get("effects", {}) or {}
        out.append({"key": c.get("key",""), "label": c.get("label",""),
                    "effects_text": format_effects_list_for_display(eff) if eff else ""})
    state["choices"] = out
    state["last_result_text"] = ""

def set_current_scene(scene_id: str) -> bool:
    scene = scenes_data["index_by_id"].get(scene_id)
    if not scene: return False
    _apply_scene_to_state(scene)
    state["current_scene_id"] = scene_id
    return True

# ---------- SSE ----------
@app.get("/stream")
def stream():
    q = queue.Queue()
    with state_lock:
        subscribers.add(q)
        q.put(_serialize_state())

    def gen():
        try:
            while True:
                try:
                    data = q.get(timeout=15)
                    yield f"data: {data}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            subscribers.discard(q)

    return Response(gen(), mimetype="text/event-stream; charset=utf-8",
                    headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"})

# ---------- API ----------
@app.post("/api/load_yaml")
def api_load_yaml():
    payload = request.get_json(force=True, silent=True) or {}
    path = (payload.get("path") or SCENES_PATH_DEFAULT).strip()
    if not path: return jsonify({"ok":False,"error":"Path required"}), 400
    try:
        data = load_scenes_from_path(path)
    except Exception as e:
        return jsonify({"ok":False,"error":f"Failed to load: {e}"}), 400

    with state_lock:
        scenes_data.update(data)
        state["resources"] = {k:int(v) for k,v in (data["resources"] or {}).items()}
        state["resource_order"] = list((data["resources"] or {}).keys())
        first_id = data["scenes"][0]["id"] if data["scenes"] else None
        if first_id: set_current_scene(first_id)
        publish_locked()
    return jsonify({"ok":True,"first_scene":first_id})

@app.get("/api/scenes")
def api_scenes():
    with state_lock:
        items = [{"id": s.get("id"), "title": s.get("title","")} for s in scenes_data["scenes"]]
    return jsonify({"ok":True,"scenes":items})

@app.post("/api/select_scene")
def api_select_scene():
    payload = request.get_json(force=True, silent=True) or {}
    sid = (payload.get("id") or "").strip()
    with state_lock:
        if not set_current_scene(sid):
            return jsonify({"ok":False,"error":"Unknown scene id"}), 404
        publish_locked()
    return jsonify({"ok":True})

@app.post("/api/choice")
def api_choice():
    payload = request.get_json(force=True, silent=True) or {}
    key = (payload.get("key") or "").strip()
    with state_lock:
        scene = scenes_data["index_by_id"].get(state.get("current_scene_id"))
        if not scene: return jsonify({"ok":False,"error":"No current scene"}), 400
        choice = next((c for c in (scene.get("choices") or []) if c.get("key")==key), None)
        if not choice: return jsonify({"ok":False,"error":"Unknown choice"}), 404

        applied: Dict[str,int] = {}
        for rname, spec in (choice.get("effects") or {}).items():
            delta, _ = parse_and_roll_effect(spec)
            state["resources"][rname] = int(state["resources"].get(rname,0)) + delta
            applied[rname] = applied.get(rname,0) + delta
            if rname not in state["resource_order"]:
                state["resource_order"].append(rname)

        state["last_result_text"] = summarize_applied_effects(applied)
        _apply_scene_to_state(scene)  # keep same scene
        state["last_result_text"] = summarize_applied_effects(applied)
        publish_locked()
    return jsonify({"ok":True})

@app.get("/api/resources")
def api_resources_get():
    with state_lock:
        return jsonify({"ok":True,"resources":state["resources"]})

@app.post("/api/resources")
def api_resources_update():
    payload = request.get_json(force=True, silent=True) or {}
    values, delta = payload.get("values"), payload.get("delta")
    with state_lock:
        if isinstance(values, dict):
            for k,v in values.items():
                try:
                    state["resources"][k] = int(v)
                    if k not in state["resource_order"]: state["resource_order"].append(k)
                except: pass
        if isinstance(delta, dict):
            for k,d in delta.items():
                try:
                    d = int(d)
                    state["resources"][k] = int(state["resources"].get(k,0)) + d
                    if k not in state["resource_order"]: state["resource_order"].append(k)
                except: pass
        publish_locked()
    return jsonify({"ok":True})

@app.post("/api/background")
def api_background():
    payload = request.get_json(force=True, silent=True) or {}
    url = payload.get("url","").strip()
    dim = max(0.0, min(1.0, float(payload.get("dim", state["bg_dim"]))))
    with state_lock:
        state["bg_url"] = url
        state["bg_dim"] = dim
        publish_locked()
    return jsonify({"ok":True})

@app.post("/api/blackout")
def api_blackout():
    payload = request.get_json(force=True, silent=True) or {}
    value = bool(payload.get("value", False))
    with state_lock:
        state["blackout"] = value
        publish_locked()
    return jsonify({"ok":True})

@app.post("/api/timer")
def api_timer():
    payload = request.get_json(force=True, silent=True) or {}
    action = (payload.get("action") or "").lower()
    sec = int(payload.get("seconds", 0))
    show = payload.get("show", None)

    with state_lock:
        remain = max(0, int(round(state["timer_ends_at"] - now()))) if state["timer_ends_at"] else max(0, int(state["timer_seconds"]))
        if action == "set":
            state["timer_seconds"] = max(0, sec); state["timer_ends_at"] = None
        elif action == "start":
            base = state["timer_seconds"] if state["timer_ends_at"] is None else remain
            state["timer_ends_at"] = now() + max(0, int(base))
        elif action == "stop":
            state["timer_seconds"] = remain; state["timer_ends_at"] = None
        elif action == "add":
            d = int(payload.get("delta", 0))
            if state["timer_ends_at"] is not None: state["timer_ends_at"] += d
            else: state["timer_seconds"] = max(0, state["timer_seconds"] + d)
        elif action == "toggle_visibility":
            state["show_timer"] = not state["show_timer"]
        if show is not None: state["show_timer"] = bool(show)
        if state["timer_ends_at"] and (state["timer_ends_at"] - now()) <= 0:
            state["timer_seconds"] = 0; state["timer_ends_at"] = None
        publish_locked()
    return jsonify({"ok":True})

@app.get("/api/state")
def api_state():
    with state_lock:
        remain = max(0, int(round(state["timer_ends_at"] - now()))) if state["timer_ends_at"] else 0
        return jsonify({**state, "timer_remaining": remain})

# ---------- Pages ----------
@app.get("/player")
def player():  return render_template("player.html")
@app.get("/gm")
def gm():      return render_template("gm.html")

if __name__ == "__main__":
    host = "127.0.0.1"
    port = 5000
    print(f"GM page: http://{host}:{port}/gm")
    app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)
