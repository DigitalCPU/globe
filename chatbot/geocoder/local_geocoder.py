import json
import re
from pathlib import Path


def normalize_text(value):
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


class LocalGeocoder:
    def __init__(self, data_path):
        self.data_path = Path(data_path)
        self.records = []
        self.alias_index = {}
        self.load()

    def load(self):
        if not self.data_path.exists():
            self.records = []
            self.alias_index = {}
            return

        data = json.loads(self.data_path.read_text(encoding="utf-8"))
        records = data.get("locations", []) if isinstance(data, dict) else []
        self.records = [self._clean_record(record) for record in records]
        self.alias_index = {}
        for record in self.records:
            for alias in record["aliases"]:
                key = normalize_text(alias)
                if key:
                    self.alias_index.setdefault(key, []).append(record)

    def _clean_record(self, record):
        name = str(record.get("name") or "").strip()
        aliases = list(record.get("aliases") or [])
        for item in [name, record.get("state"), record.get("country"), record.get("postal_code")]:
            if item:
                aliases.append(str(item))
        return {
            "name": name,
            "type": str(record.get("type") or "place"),
            "lat": float(record["lat"]),
            "lon": float(record["lon"]),
            "country": str(record.get("country") or ""),
            "state": str(record.get("state") or ""),
            "postal_code": str(record.get("postal_code") or ""),
            "aliases": sorted(set(alias.strip() for alias in aliases if str(alias).strip())),
        }

    def search(self, query, limit=8):
        raw_query = str(query or "").strip()
        normalized = normalize_text(raw_query)
        if not normalized:
            return []
        if normalized in {"world", "global", "worldwide", "anywhere"}:
            return [{
                "name": "Worldwide",
                "type": "worldwide",
                "lat": 0.0,
                "lon": 0.0,
                "country": "",
                "state": "",
                "postal_code": "",
                "score": 1.0,
            }]

        matches = []
        seen = set()

        def add(record, score):
            key = (record["name"], record["lat"], record["lon"])
            if key in seen:
                return
            seen.add(key)
            item = {name: value for name, value in record.items() if name != "aliases"}
            item["score"] = round(score, 3)
            matches.append(item)

        for record in self.alias_index.get(normalized, []):
            add(record, 1.0)

        if len(matches) < limit:
            for record in self.records:
                searchable = normalize_text(" ".join(record["aliases"]))
                if normalized in searchable:
                    coverage = min(0.95, len(normalized) / max(len(searchable), 1) + 0.35)
                    add(record, coverage)
                if len(matches) >= limit:
                    break

        matches.sort(key=lambda item: item["score"], reverse=True)
        return matches[:limit]
