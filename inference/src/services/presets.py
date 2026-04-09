from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _presets_path() -> Path:
    # inference/src/services -> inference/presets.json
    return Path(__file__).resolve().parents[2] / "presets.json"


def load_presets() -> dict[str, dict[str, Any]]:
    path = _presets_path()
    with path.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, dict):
        raise ValueError("presets.json must contain an object")
    return raw


def get_preset(preset_id: str) -> dict[str, Any]:
    presets = load_presets()
    if preset_id not in presets:
        raise KeyError(f"Unknown preset_id: {preset_id}")
    preset = presets[preset_id]
    if not isinstance(preset, dict):
        raise ValueError(f"Preset '{preset_id}' must be an object")
    return {"id": preset_id, **preset}

