"""Свежие дополнения родных для копии сайта: берёт их с сервера дополнений и пишет entries.json.
Годы жизни публикуются как есть — так решил владелец древа.
Печатает changed=true|false для GitHub Actions."""
import json, os, re, urllib.request

SRC = "https://roddrevo.netlify.app/api"
LIVE = "https://aevkone.github.io/roddrevo/entries.json"
KEEP = ["id", "created", "kind", "person", "personName", "author", "relation", "name", "dates", "place", "occupation", "text", "verified"]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def public_dates(d):
    # с 21.10.2026 годы жизни показываем у всех — решение владельца древа
    return d or ""


try:
    items = get(SRC).get("entries", [])
    out = []
    for e in items:
        e = {k: e[k] for k in KEEP if k in e}
        if e.get("dates"):
            e["dates"] = public_dates(e["dates"])
        out.append(e)
    data = {"entries": out}
    with open("entries.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
except Exception as err:
    print("сервер дополнений не ответил:", err)
    data = json.load(open("entries.json", encoding="utf-8"))
try:
    changed = get(LIVE) != data
except Exception:
    changed = True
print("entries:", len(data["entries"]), "changed:", changed)
gh = os.environ.get("GITHUB_OUTPUT")
if gh:
    with open(gh, "a") as f:
        f.write("changed=%s\n" % ("true" if changed else "false"))
