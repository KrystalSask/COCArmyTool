"""Extract real army-card crops and build a visual validation review page."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
GAME_DATA = ROOT / "src" / "data" / "gameData.generated.json"
ZH_CN_NAMES = ROOT / "src" / "data" / "localization.zh-CN.ts"
DEFAULT_OUTPUT = ROOT / "artifacts" / "army-card-real-validation-review-v1"
MODEL_SIZE = 160
BATCHES = (
    ("batch-01-dev", "templates.batch-01.json"),
    ("batch-02-request", "templates.batch-02.json"),
)
DATA_KEYS = {"troop": "troops", "spell": "spells", "siege": "siegeMachines"}


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_") or "unnamed"


def load_zh_cn_names() -> dict[str, str]:
    """Reuse the app's audited mainland-China terminology without duplicating it."""
    source = ZH_CN_NAMES.read_text(encoding="utf-8")
    return dict(re.findall(r"'([^']+)'\s*:\s*'([^']+)'", source))


def load_classes() -> tuple[list[dict], dict[tuple[str, int], dict]]:
    data = json.loads(GAME_DATA.read_text(encoding="utf-8"))
    zh_cn_names = load_zh_cn_names()
    classes = []
    for kind in ("troop", "spell", "siege"):
        for item in data[DATA_KEYS[kind]]:
            english_name = item["name"]
            chinese_name = zh_cn_names.get(english_name, english_name)
            classes.append({
                "index": len(classes), "kind": kind, "id": item["id"], "name": english_name,
                "nameZh": chinese_name, "displayName": f"{chinese_name}（{english_name}）",
                "class": f'{kind}_{item["id"]:03d}_{slugify(english_name)}',
            })
    return classes, {(item["kind"], item["id"]): item for item in classes}


def normalize_crop(crop: Image.Image) -> tuple[Image.Image, int]:
    crop = crop.convert("RGB")
    scale = MODEL_SIZE / max(1, crop.height)
    width = max(1, round(crop.width * scale))
    resized = crop.resize((width, MODEL_SIZE), Image.Resampling.LANCZOS)
    if resized.width > MODEL_SIZE:
        resized = resized.crop((0, 0, MODEL_SIZE, MODEL_SIZE))
    # Match the synthetic generator's right-padding convention.
    canvas = Image.new("RGB", (MODEL_SIZE, MODEL_SIZE), (57, 64, 71))
    canvas.paste(resized, (0, 0))
    return canvas, resized.width


def write_review_html(output: Path, records: list[dict], classes: list[dict]) -> None:
    sample_payload = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    class_payload = json.dumps(classes, ensure_ascii=False).replace("</", "<\\/")
    page = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>真实军队卡片验证集审核</title><style>
:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif}body{margin:0;background:#17191d;color:#eef2f5}
header{position:sticky;top:0;z-index:2;padding:14px 20px;background:#20242aee;border-bottom:1px solid #39414b}h1{margin:0 0 7px;font-size:20px}.help{font-size:13px;color:#bcc5cf;margin-bottom:9px}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}button,select{border:1px solid #596573;border-radius:7px;padding:7px 10px;background:#303741;color:#fff}button{cursor:pointer}#progress{margin-left:auto;color:#b9c6d3}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(214px,1fr));gap:12px;padding:16px}article{background:#242930;border:2px solid transparent;border-radius:10px;padding:10px}article.approved,article.corrected{border-color:#48be78}article.rejected{border-color:#ef6b73}
img{display:block;width:160px;height:160px;margin:auto;background:#394047}.name{font-size:12px;margin-top:7px;word-break:break-all}.meta{font-size:11px;line-height:1.5;color:#aeb8c2}.actions{display:flex;gap:6px;margin-top:7px}.actions button{flex:1}.yes{background:#216b43}.no{background:#7b3037}.correct{width:100%;margin-top:6px}
</style></head><body><header><h1>真实军队卡片验证集审核</h1>
<div class="help">核对裁框和建议类别。三个主区域按配兵链接顺序对齐；援军区旧标签顺序不可靠，必须逐张确认或改标，禁止批量确认。</div>
<div class="toolbar"><select id="kind"><option value="all">全部类型</option><option value="troop">兵种</option><option value="spell">法术</option><option value="siege">攻城机器</option></select>
<select id="region"><option value="mainOnly" selected>三个主区域</option><option value="all">全部区域</option><option value="mainTroops">主兵种</option><option value="mainSpells">主法术</option><option value="mainSiege">攻城机器</option><option value="castleArmy">援军（逐张审核）</option></select>
<select id="status"><option value="all">全部状态</option><option value="pending">未审核</option><option value="approved">已确认</option><option value="corrected">已改标</option><option value="rejected">已排除</option></select>
<button id="approve-visible">确认当前页全部</button><button id="export">导出审核结果 JSON</button><button id="clear">清空结果</button><span id="progress"></span></div></header><main id="grid"></main>
<script>const samples=__SAMPLES__,classes=__CLASSES__,key='army-card-real-validation-review-v1';let decisions=JSON.parse(localStorage.getItem(key)||'{}');
const grid=document.querySelector('#grid'),kind=document.querySelector('#kind'),region=document.querySelector('#region'),status=document.querySelector('#status');
const state=p=>decisions[p]?.decision||'pending';const save=()=>localStorage.setItem(key,JSON.stringify(decisions));
const regionMatch=s=>region.value==='all'||(region.value==='mainOnly'&&s.region!=='castleArmy')||s.region===region.value;
const visible=()=>samples.filter(s=>(kind.value==='all'||s.kind===kind.value)&&regionMatch(s)&&(status.value==='all'||state(s.path)===status.value));
function render(){const shown=visible();grid.replaceChildren(...shown.map(s=>{const a=document.createElement('article');a.className=state(s.path);const suggested=classes.find(c=>c.class===s.class);const selectedClass=decisions[s.path]?.class||s.class;const selected=classes.find(c=>c.class===selectedClass);const opts=['troop','spell','siege'].map(k=>`<optgroup label="${{troop:'兵种',spell:'法术',siege:'攻城机器'}[k]}">${classes.filter(c=>c.kind===k).map(c=>`<option value="${c.class}" ${c.class===selectedClass?'selected':''}>${c.displayName}</option>`).join('')}</optgroup>`).join('');const saved=state(s.path)==='corrected'?`<br>已改为：${selected?.displayName||selectedClass}`:'';a.innerHTML=`<img loading="lazy" src="${s.path}"><div class="name">原建议：${suggested?.displayName||s.class}${saved}</div><div class="meta">${s.batch}/${s.sampleId} · ${s.region} · 原裁片 ${s.cropSize[0]}×${s.cropSize[1]} · 内容宽 ${s.contentWidth}/160</div><select class="correct">${opts}</select><div class="actions"><button class="yes">保存确认</button><button class="no">排除</button></div>`;a.querySelector('.yes').onclick=()=>{const picked=a.querySelector('.correct').value;decisions[s.path]={decision:picked===s.class?'approved':'corrected',class:picked};save();render()};a.querySelector('.no').onclick=()=>{decisions[s.path]={decision:'rejected'};save();render()};return a}));
const done=samples.filter(s=>state(s.path)!=='pending').length;document.querySelector('#progress').textContent=`已审核 ${done}/${samples.length} · 当前显示 ${shown.length}`}
[kind,region,status].forEach(e=>e.onchange=render);document.querySelector('#approve-visible').onclick=()=>{const shown=visible();if(shown.some(s=>s.region==='castleArmy')){alert('援军区标签顺序不可靠，不能批量确认，请逐张核对。');return}if(confirm(`确认当前筛选出的 ${shown.length} 张？`)){shown.forEach(s=>decisions[s.path]={decision:'approved',class:s.class});save();render()}};
document.querySelector('#export').onclick=()=>{const result={schemaVersion:1,dataset:'army-card-real-validation-review-v1',decisions:samples.map(s=>({...s,...(decisions[s.path]||{decision:'pending'})}))};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));a.download='army-card-real-validation-review.json';a.click();URL.revokeObjectURL(a.href)};
document.querySelector('#clear').onclick=()=>{if(confirm('确定清空全部审核结果？')){decisions={};save();render()}};render();</script></body></html>"""
    page = page.replace("__SAMPLES__", sample_payload).replace("__CLASSES__", class_payload)
    (output / "review.html").write_text(page, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    artifacts = (ROOT / "artifacts").resolve()
    if output == artifacts or artifacts not in output.parents:
        raise RuntimeError(f"output must be below {artifacts}")
    if output.exists():
        if not args.force:
            raise FileExistsError(f"output exists; pass --force: {output}")
        shutil.rmtree(output)
    (output / "images").mkdir(parents=True)

    classes, class_lookup = load_classes()
    records = []
    for batch, report_name in BATCHES:
        batch_root = ROOT / "recognition-samples" / batch
        report = json.loads((batch_root / "reports" / report_name).read_text(encoding="utf-8"))
        panel_dir = batch_root / "reports" / "preprocessed" / "panels"
        for observation in report["observations"]:
            item = class_lookup[(observation["kind"], observation["id"])]
            panel_path = panel_dir / f'{observation["sampleId"]}.png'
            with Image.open(panel_path) as panel:
                panel = panel.convert("RGB")
                x, y, width, height = observation["rect"]
                left, top = round(x * panel.width), round(y * panel.height)
                right, bottom = round((x + width) * panel.width), round((y + height) * panel.height)
                crop = panel.crop((left, top, right, bottom))
            normalized, content_width = normalize_crop(crop)
            identity = f'{batch}:{observation["sampleId"]}:{observation["region"]}:{observation["index"]}'
            filename = hashlib.sha1(identity.encode()).hexdigest()[:16] + ".png"
            path = Path("images") / filename
            normalized.save(output / path, "PNG", optimize=True)
            records.append({
                "path": path.as_posix(), "class": item["class"], "kind": item["kind"],
                "id": item["id"], "name": item["name"], "nameZh": item["nameZh"],
                "displayName": item["displayName"], "batch": batch,
                "sampleId": observation["sampleId"], "sourceGroup": f'{batch}:{observation["sampleId"]}',
                "layout": observation["layout"], "device": observation["device"],
                "region": observation["region"], "index": observation["index"],
                "rect": observation["rect"], "cropSize": [crop.width, crop.height],
                "contentWidth": content_width,
            })
    records.sort(key=lambda row: (row["kind"], row["id"], row["sourceGroup"], row["region"], row["index"]))
    (output / "candidates.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in records), encoding="utf-8",
    )
    summary = {
        "schemaVersion": 1, "candidateCount": len(records), "classCount": len({r["class"] for r in records}),
        "sourceGroups": len({r["sourceGroup"] for r in records}), "classes": classes,
        "note": "Candidate labels come from known army links and still require visual confirmation.",
    }
    (output / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_review_html(output, records, classes)
    (output / "README.md").write_text(
        "# 真实军队卡片验证集审核\n\n"
        f"共 {len(records)} 张候选，覆盖 {summary['classCount']} 类，来自 {summary['sourceGroups']} 张真实截图。\n\n"
        "打开 `review.html`：正确点“确认”，错误类别选择正确项后点“改标”，合框或裁坏的候选点“排除”。"
        "完成后导出 JSON。未经审核的候选不能进入正式验证集。\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "output": str(output), "candidateCount": summary["candidateCount"],
        "classCount": summary["classCount"], "sourceGroups": summary["sourceGroups"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
