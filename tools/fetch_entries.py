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

    # подстраховка к photo.js: если ч/б фото пришло со старой (закэшированной) страницы без белого фона —
    # делаем то же здесь: голова резкая, вокруг размытие, плавно уходящее в белый
    def whiten(raw, ext):
        try:
            import io, math
            from PIL import Image, ImageFilter
            im = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            return raw, ext
        n = im.size[0]
        if n < 64 or im.size[1] != n:
            return raw, ext
        px = im.load(); c = n / 2; sat = cnt = 0; edge = []
        for y in range(0, n, 2):
            for x in range(0, n, 2):
                d = math.hypot(x + .5 - c, y + .5 - c) / n
                r, g, b = px[x, y]
                if d < 0.44:
                    mx = max(r, g, b); sat += (mx - min(r, g, b)) / mx if mx else 0; cnt += 1
                elif d < 0.5:
                    edge.append((r + g + b) / 3)
        if not cnt or sat / cnt >= 0.14 or (edge and sum(edge) / len(edge) > 210 and min(edge) > 110):
            return raw, ext  # цветное — не трогаем; края уже белые — уже обработано

        def oval(r0, r1):
            m = Image.new("L", (n, n)); mp = m.load()
            for y in range(n):
                for x in range(n):
                    t = (math.hypot((x + .5 - c) / n, (y + .5 - c) / (n * 1.15)) - r0) / (r1 - r0)
                    t = min(1, max(0, t)); mp[x, y] = round(255 * (1 - t * t * (3 - 2 * t)))
            return m
        out = Image.composite(im.filter(ImageFilter.GaussianBlur(n / 40)), Image.new("RGB", im.size, "white"), oval(0.26, 0.5))
        out = Image.composite(im, out, oval(0.24, 0.40))
        buf = io.BytesIO(); out.save(buf, "JPEG", quality=88)
        return buf.getvalue(), "jpeg"

    def save(e, ext, data):
        try:
            raw = base64.b64decode(data)
        except Exception:
            raw = b""
        good = (ext == "webp" and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP") or (ext == "jpeg" and raw[:2] == bytes([255, 216]))
        if not good or len(raw) > 30000:
            e["text"] = "Фото не удалось прочитать"
            return
        raw, ext = whiten(raw, ext)
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
