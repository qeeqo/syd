import { useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import {
  normalizeSkillName,
  MAX_SKILL_INSTRUCTIONS,
  type Skill,
} from "../skills";
import { useTheme } from "./themeContext";

type SkillsPopupProps = {
  skills: Skill[];
  // `previousName` is the handle being edited (so App can clean up a rename),
  // or null when creating. App owns the write; this popup only validates.
  onSave: (skill: Skill, previousName: string | null) => void;
  onDelete: (name: string) => void;
  onDismiss: () => void;
};

const MAX_VISIBLE = 8;

// Two modes: a list of skills and an editor form. Skills are what @name invokes
// in a message — this is where they're authored without leaving syd.
export default function SkillsPopup({
  skills,
  onSave,
  onDelete,
  onDismiss,
}: SkillsPopupProps) {
  const t = useTheme();
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [selected, setSelected] = useState(0);
  // Two-step delete guard: first `d` arms for this name, second confirms. Any
  // other key disarms.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // The textarea is uncontrolled (seeded once via initialValue), so it's
  // remounted per session via `editKey` and read back through `textRef`.
  const [editingName, setEditingName] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [initialInstructions, setInitialInstructions] = useState("");
  const [editKey, setEditKey] = useState(0);
  const [focusedField, setFocusedField] = useState<"name" | "instructions">(
    "name",
  );
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<TextareaRenderable | null>(null);

  // The list may have shrunk under us after a delete.
  const safeSelected = skills.length === 0 ? 0 : Math.min(selected, skills.length - 1);

  function openNew() {
    setEditingName(null);
    setTitleDraft("");
    setInitialInstructions("");
    setError(null);
    setFocusedField("name");
    setEditKey((k) => k + 1);
    setMode("edit");
  }

  function openEdit(skill: Skill) {
    setEditingName(skill.name);
    setTitleDraft(skill.name);
    setInitialInstructions(skill.instructions);
    setError(null);
    setFocusedField("name");
    setEditKey((k) => k + 1);
    setMode("edit");
  }

  function backToList() {
    setError(null);
    setMode("list");
  }

  function save() {
    const name = normalizeSkillName(titleDraft);
    if (!name) {
      setError("Enter a name using letters, numbers, or hyphens.");
      setFocusedField("name");
      return;
    }
    const body = (textRef.current?.plainText ?? "").trim();
    if (body.length === 0) {
      setError("Instructions can't be empty.");
      setFocusedField("instructions");
      return;
    }
    if (body.length > MAX_SKILL_INSTRUCTIONS) {
      setError(`Instructions are too long (max ${MAX_SKILL_INSTRUCTIONS} characters).`);
      setFocusedField("instructions");
      return;
    }
    // Renaming onto another skill, or creating a duplicate. Keeping a skill's
    // own name is fine.
    if (skills.some((s) => s.name === name && s.name !== editingName)) {
      setError(`A skill named @${name} already exists.`);
      setFocusedField("name");
      return;
    }
    onSave({ name, instructions: body }, editingName);
    backToList();
  }

  useKeyboard((key) => {
    if (mode === "list") {
      switch (key.name) {
        case "up":
          key.preventDefault();
          setConfirmDelete(null);
          if (skills.length > 0) {
            setSelected((i) => (i - 1 + skills.length) % skills.length);
          }
          break;
        case "down":
          key.preventDefault();
          setConfirmDelete(null);
          if (skills.length > 0) {
            setSelected((i) => (i + 1) % skills.length);
          }
          break;
        case "return":
          key.preventDefault();
          if (skills.length > 0) openEdit(skills[safeSelected]);
          break;
        case "n":
          key.preventDefault();
          setConfirmDelete(null);
          openNew();
          break;
        case "d": {
          key.preventDefault();
          if (skills.length === 0) break;
          const name = skills[safeSelected].name;
          if (confirmDelete === name) {
            onDelete(name);
            setConfirmDelete(null);
            setSelected((i) => Math.max(0, Math.min(i, skills.length - 2)));
          } else {
            setConfirmDelete(name);
          }
          break;
        }
        case "escape":
        case "q":
          key.preventDefault();
          // Disarm a pending delete first; only then close.
          if (confirmDelete) setConfirmDelete(null);
          else onDismiss();
          break;
      }
      return;
    }

    // Intercept only the three chrome keys; everything else falls through to
    // the focused field so typing works normally.
    if (key.name === "tab") {
      key.preventDefault();
      setFocusedField((f) => (f === "name" ? "instructions" : "name"));
      return;
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      save();
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      backToList();
    }
  });

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title={
        mode === "list"
          ? " skills "
          : editingName
            ? ` edit @${editingName} `
            : " new skill "
      }
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      {mode === "list" ? (
        <SkillList
          skills={skills}
          selected={safeSelected}
          confirmDelete={confirmDelete}
        />
      ) : (
        <SkillEditor
          editKey={editKey}
          titleDraft={titleDraft}
          initialInstructions={initialInstructions}
          focusedField={focusedField}
          error={error}
          textRef={textRef}
          onTitleInput={setTitleDraft}
          onTitleSubmit={() => setFocusedField("instructions")}
        />
      )}

      <text fg={t.textDim} marginTop={1}>
        {mode === "list"
          ? confirmDelete
            ? `press d again to delete @${confirmDelete} · esc cancel`
            : "↑↓ select · ↵ edit · n new · d delete · esc close"
          : "tab switch field · ^s save · esc cancel"}
      </text>
    </box>
  );
}

// Windowed so a long list stays compact, mirroring the /mcp server list.
function SkillList({
  skills,
  selected,
  confirmDelete,
}: {
  skills: Skill[];
  selected: number;
  confirmDelete: string | null;
}) {
  const t = useTheme();
  if (skills.length === 0) {
    return (
      <box flexDirection="column" width="100%">
        <text fg={t.textSecondary} wrapMode="word">
          No skills yet. A skill is a set of saved instructions you invoke by
          writing @name in a message.
        </text>
        <text fg={t.textMuted} marginTop={1}>
          Press n to create one — or just ask syd to make one.
        </text>
      </box>
    );
  }

  const total = skills.length;
  const start =
    total <= MAX_VISIBLE
      ? 0
      : Math.min(
          Math.max(0, selected - Math.floor(MAX_VISIBLE / 2)),
          total - MAX_VISIBLE,
        );
  const visible = skills.slice(start, start + MAX_VISIBLE);
  const hiddenAbove = start;
  const hiddenBelow = total - (start + visible.length);

  const nameWidth = Math.min(
    skills.reduce((w, s) => Math.max(w, s.name.length), 0),
    24,
  );

  return (
    <box flexDirection="column" width="100%">
      <text fg={t.textSecondary} marginBottom={1}>
        {total} skill{total === 1 ? "" : "s"} · invoke one by writing @name in a
        message.
      </text>

      {hiddenAbove > 0 && <text fg={t.textFaint}> ↑ {hiddenAbove} more</text>}
      {visible.map((skill, i) => {
        const isSelected = start + i === selected;
        const armed = confirmDelete === skill.name;
        const name =
          skill.name.length > nameWidth
            ? `${skill.name.slice(0, nameWidth - 1)}…`
            : skill.name.padEnd(nameWidth, " ");
        const firstLine = skill.instructions.split("\n", 1)[0].trim();
        const hint =
          firstLine.length > 52 ? `${firstLine.slice(0, 51)}…` : firstLine;
        return (
          <box
            key={skill.name}
            paddingX={1}
            flexDirection="row"
            backgroundColor={
              armed ? t.armedBg : isSelected ? t.selectionBg : undefined
            }
          >
            <text
              fg={armed ? t.danger : isSelected ? t.textSelected : t.accent}
              attributes={TextAttributes.BOLD}
            >
              @{name}
            </text>
            {hint.length > 0 && (
              <text fg={isSelected ? t.textSecondary : t.textMuted}>
                {"  "}
                {hint}
              </text>
            )}
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg={t.textFaint}> ↓ {hiddenBelow} more</text>}
    </box>
  );
}

// Only the focused field takes keystrokes (Tab toggles). The textarea is
// uncontrolled — seeded via initialValue, remounted per session with `editKey`,
// read back through the ref on save.
function SkillEditor({
  editKey,
  titleDraft,
  initialInstructions,
  focusedField,
  error,
  textRef,
  onTitleInput,
  onTitleSubmit,
}: {
  editKey: number;
  titleDraft: string;
  initialInstructions: string;
  focusedField: "name" | "instructions";
  error: string | null;
  textRef: React.RefObject<TextareaRenderable | null>;
  onTitleInput: (value: string) => void;
  onTitleSubmit: () => void;
}) {
  const t = useTheme();
  const nameFocused = focusedField === "name";
  return (
    <box flexDirection="column" width="100%">
      <text fg={nameFocused ? t.textSelected : t.accent}>
        Name (used as @name)
      </text>
      <box
        border
        borderColor={nameFocused ? t.borderActive : t.border}
        marginBottom={1}
      >
        <input
          value={titleDraft}
          placeholder="e.g. review"
          focused={nameFocused}
          paddingLeft={1}
          flexGrow={1}
          onInput={onTitleInput}
          onSubmit={onTitleSubmit}
        />
      </box>

      <text fg={!nameFocused ? t.textSelected : t.accent}>
        Instructions (what syd should do when you @mention this)
      </text>
      <box
        border
        borderColor={!nameFocused ? t.borderActive : t.border}
        height={10}
      >
        <textarea
          key={editKey}
          ref={textRef}
          initialValue={initialInstructions}
          placeholder="Describe what syd should do…"
          focused={!nameFocused}
          paddingLeft={1}
          flexGrow={1}
        />
      </box>

      {error && (
        <text fg={t.danger} marginTop={1} wrapMode="word">
          {error}
        </text>
      )}
    </box>
  );
}
