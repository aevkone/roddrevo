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


def split_photos(entries, outdir):
    import base64, os, re as _re
    os.makedirs(os.path.join(str(outdir), "photos"), exist_ok=True)

    def save(e, ext, data):
        try:
            raw = base64.b64decode(data)
        except Exception:
            raw = b""
        good = (ext == "webp" and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP") or (ext == "jpeg" and raw[:2] == bytes([255, 216]))
        if not good or len(raw) > 30000:
            e["text"] = "Фото не удалось прочитать"
            return
        name = _re.sub("[^A-Za-z0-9_-]", "_", str(e.get("person") or "x"))
        with open(os.path.join(str(outdir), "photos", name + (".webp" if ext == "webp" else ".jpg")), "wb") as f:
            f.write(raw)
        e["text"] = "§PHOTO1@" + ext

    # крупные фото приходят частями «§PHOTO2:группа:номер:всего:формат:данные»
    groups = {}
    for e in entries:
        m = _re.match("^§PHOTO2:([0-9a-f]{8}):([0-9]+):([0-9]+):(webp|jpeg):", e.get("text") or "")
        if e.get("kind") == "fact" and m:
            g = groups.setdefault(m.group(1), {"n": int(m.group(3)), "ext": m.group(4), "parts": {}, "first": None})
            g["parts"][int(m.group(2))] = (e, (e.get("text") or "")[m.end():])
    for g in sorted(groups.values(), key=lambda g: min(p[0].get("created") or 0 for p in g["parts"].values())):
        if len(g["parts"]) != g["n"] or 0 not in g["parts"]:
            continue  # не все части дошли — подождём следующего обновления
        save(g["parts"][0][0], g["ext"], "".join(g["parts"][i][1] for i in range(g["n"])))
        for i in range(1, g["n"]):
            g["parts"][i][0]["text"] = "§PHOTOX"

    # прежний формат: одно дополнение «§PHOTO1:формат:данные» (+ хвост в occupation/place/name)
    for e in sorted(entries, key=lambda x: x.get("created") or 0):
        t = e.get("text") or ""
        if e.get("kind") != "fact" or not t.startswith("§PHOTO1:"):
            continue
        parts = t.split(":", 2)
        ext = parts[1] if len(parts) == 3 else ""
        save(e, ext, (parts[2] if len(parts) == 3 else "") + (e.get("occupation") or "") + (e.get("place") or "") + (e.get("name") or ""))
        e["occupation"] = e["place"] = e["name"] = ""
    return entries


try:
    items = get(SRC).get("entries", [])
    out = []
    for e in items:
        e = {k: e[k] for k in KEEP if k in e}
        if e.get("dates"):
            e["dates"] = public_dates(e["dates"])
        out.append(e)
    data = {"entries": split_photos(out, ".")}
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
