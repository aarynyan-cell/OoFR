import { type CSSProperties, type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { prepareMaterial } from "../ai/enrich";
import { numbersToFrench } from "../text/numbers";
import { href, navigate } from "../app/router";
import { toast } from "../app/toast";
import { useLive } from "../db/live";
import { db } from "../db/database";
import { createMaterial, createTape, deleteMaterial, getSettings, listTapes, materialText, updateMaterial } from "../db/repo";
import { MATERIAL_TYPES, type MaterialType, countSpeakers, guessLanguage, inferMaterialType, splitSentences } from "../text/split";
import { BackIcon, FileIcon } from "../ui/icons";

const MAX_FILE_BYTES = 2_000_000;

// New material, or (with editId) editing one: same form, so editing feels familiar.
export function AddMaterialPage({ tapeId, editId }: { tapeId?: string; editId?: string }) {
  const tapes = useLive(() => listTapes(), []);
  const editing = useLive(async () => (editId ? ((await db.materials.get(editId)) ?? null) : null), [editId]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [chosenTape, setChosenTape] = useState(tapeId ?? "");
  const [chosenType, setChosenType] = useState<MaterialType | "">("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!editId);

  // Fill the form once with the material being edited.
  useEffect(() => {
    if (!editing || loaded) return;
    setTitle(editing.title);
    setText(materialText(editing));
    setChosenTape(editing.tapeId);
    setChosenType(editing.materialType);
    setLoaded(true);
  }, [editing, loaded]);

  useEffect(() => {
    if (!chosenTape && tapes?.length) setChosenTape(tapeId && tapes.some((tape) => tape.id === tapeId) ? tapeId : tapes[0].id);
  }, [tapes, tapeId, chosenTape]);

  const materialType = chosenType || (text.trim() ? inferMaterialType(text) : "自定义文本");
  const language = guessLanguage(text);
  // The preview shows numbers as words, as the lesson will.
  const sentences = useMemo(
    () => splitSentences(text, chosenType || undefined).map((part) => (language === "fr" ? { ...part, text: numbersToFrench(part.text) } : part)),
    [text, chosenType, language]
  );
  const speakers = countSpeakers(sentences);

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast("文件太大了，请选 2 MB 以内的文本");
      return;
    }
    setText(await file.text());
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sentences.length) {
      toast("先粘贴一段法语");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateMaterial(editing.id, { title, tapeId: chosenTape || editing.tapeId, text, materialType });
        toast("已保存修改");
        navigate({ name: "lesson", id: editing.id }, { replace: true });
        return;
      }
      const tape = chosenTape || (await createTape("我的素材")).id;
      const material = await createMaterial({ title, tapeId: tape, text, materialType, language });
      // The local AI starts translating the new lesson straight away.
      void getSettings().then((current) => current.aiPrepare && prepareMaterial(material));
      navigate({ name: "lesson", id: material.id }, { replace: true });
    } catch (error) {
      toast(error instanceof Error ? error.message : "没能生成课程");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`删除「${editing.title}」？这条素材和它的录音会一起删除，收藏到词句本的内容会保留。`)) return;
    await deleteMaterial(editing.id);
    toast(`已删除「${editing.title}」`);
    navigate({ name: "tapes", tapeId: editing.tapeId }, { replace: true });
  };

  if (editId && editing === null) {
    return (
      <main className="page">
        <p className="empty">找不到这条素材，可能已经删除了。</p>
        <a className="button button-outline" href={href({ name: "tapes" })}>回到磁带</a>
      </main>
    );
  }

  return (
    <main className="page page-form">
      <header className="lesson-head">
        <a
          className="icon-button"
          href={editId ? href({ name: "lesson", id: editId }) : href({ name: "tapes", tapeId: chosenTape || undefined })}
          aria-label={editId ? "返回课程" : "返回磁带"}
        >
          <BackIcon />
        </a>
        <h1 className="lesson-title grow">{editId ? "编辑素材" : "新建素材"}</h1>
      </header>

      <form className="stack-16 gutter" onSubmit={submit}>
        <label className="field">
          标题
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="比如：在咖啡馆点单" maxLength={60} />
        </label>

        {tapes && tapes.length > 0 && (
          <div className="field" role="group" aria-label="放进哪盘磁带">
            放进哪盘磁带
            <div className="chips">
              {tapes.map((tape) => (
                <button
                  key={tape.id}
                  type="button"
                  className="chip chip-tape"
                  aria-pressed={tape.id === chosenTape}
                  style={{ "--tape-color": tape.color } as CSSProperties}
                  onClick={() => setChosenTape(tape.id)}
                >
                  <span className="tape-swatch" aria-hidden="true" />{tape.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field">
          法语文本
          <textarea
            className="fr"
            lang="fr"
            rows={7}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"粘贴一段法语。对话可以写成：\nA : Bonjour !\nB : Salut, ça va ?"}
          />
        </label>

        <div className="row-between">
          <label className="button button-outline button-small file-button">
            <FileIcon size={18} />导入 .txt 文件
            <input type="file" accept=".txt,text/plain" className="visually-hidden" onChange={readFile} />
          </label>
          <span className="dim small">也可以直接粘贴</span>
        </div>

        {sentences.length > 0 && (
          <section className="card stack-10" aria-live="polite">
            <h2 className="section-title muted">自动识别</h2>
            <div className="chips">
              <span className="tag">{language === "en" ? "英语" : "法语"}</span>
              <span className="tag">{materialType}</span>
              {speakers > 1 && <span className="tag">{speakers} 位说话人</span>}
              <span className="tag">{sentences.length} 句</span>
            </div>
            <label className="field field-inline">
              类型不对？
              <select value={chosenType} onChange={(event) => setChosenType(event.target.value as MaterialType | "")}>
                <option value="">自动</option>
                {MATERIAL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <ol className="preview">
              {sentences.slice(0, 3).map((sentence, index) => (
                <li key={index}>{sentence.speakerLabel && <b>{sentence.speakerLabel}　</b>}<span className="fr" lang={language}>{sentence.text}</span></li>
              ))}
            </ol>
            {sentences.length > 3 && <p className="dim small">还有 {sentences.length - 3} 句…</p>}
          </section>
        )}

        {editId && (
          <p className="dim small">没改动的句子会保留译文、讲解和录音。</p>
        )}
        <button type="submit" className="button button-primary button-block" disabled={saving || !loaded}>
          {saving ? "正在保存…" : editId ? "保存修改" : "生成课程"}
        </button>
        {editId && (
          <button type="button" className="button button-danger button-block" onClick={remove}>删除这条素材</button>
        )}
      </form>
    </main>
  );
}
