import { useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import {
  normalizeSkillName,
  MAX_SKILL_INSTRUCTIONS,
  type Skill,
} from "../skills";

type SkillsPopupProps = {
  skills: Skill[];
  // Persist a created or edited skill. `previousName` is the handle being
  // edited (so App can clean up a rename), or null when creating. App owns the
  // actual write + state update; this popup only validates and hands off.
  onSave: (skill: Skill, previousName: string | null) => void;
  onDelete: (name: string) => void;
  onDismiss: () => void;
};

// How many skill rows the list shows before it windows around the selection.
const MAX_VISIBLE = 8;

// The /skills manager, sibling to /settings and /mcp. Two modes: a list of
// skills (navigate, edit, delete, new) and an editor form (name + instructions).
// Every save/delete persists via App to config.json. Skills are what @name
// invokes in a message — this is where they're authored without leaving syd.
export default function SkillsPopup({
  skills,
  onSave,
  onDelete,
  onDismiss,
}: SkillsPopupProps) {
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [selected, setSelected] = useState(0);
  // The two-step delete guard: first `d` arms it for this name, second `d`
  // confirms. Any navigation/other key disarms it.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Editor state. `editingName` is the handle being edited, or null for a new
  // skill. The textarea is uncontrolled (seeded once via initialValue), so it's
  // remounted per session via `editKey` and read back through `textRef` on save.
  const [editingName, setEditingName] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [initialInstructions, setInitialInstructions] = useState("");
  const [editKey, setEditKey] = useState(0);
  const [focusedField, setFocusedField] = useState<"name" | "instructions">(
    "name",
  );
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<TextareaRenderable | null>(null);

  // Keep the highlight in range even if the list shrank under us (after a delete).
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
    // A different existing skill already owns this handle (renaming onto it, or
    // creating a duplicate). Editing a skill and keeping its name is fine.
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
            // Keep the highlight on a valid row after the list shrinks.
            setSelected((i) => Math.max(0, Math.min(i, skills.length - 2)));
          } else {
            setConfirmDelete(name);
          }
          break;
        }
        case "escape":
        case "q":
          key.preventDefault();
          // First disarm a pending delete; only then close the popup.
          if (confirmDelete) setConfirmDelete(null);
          else onDismiss();
          break;
      }
      return;
    }

    // Edit mode: intercept only the three chrome keys; every other key falls
    // through to the focused <input> / <textarea> so typing works normally.
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
      borderColor="#2a3350"
      backgroundColor="#141824"
      title={
        mode === "list"
          ? " skills "
          : editingName
            ? ` edit @${editingName} `
            : " new skill "
      }
      titleColor="#8bb4ff"
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

      <text fg="#5b6472" marginTop={1}>
        {mode === "list"
          ? confirmDelete
            ? `press d again to delete @${confirmDelete} · esc cancel`
            : "↑↓ select · ↵ edit · n new · d delete · esc close"
          : "tab switch field · ^s save · esc cancel"}
      </text>
    </box>
  );
}

// The list of skills: one highlighted row per skill (handle + one-line hint),
// windowed so a long list stays compact, mirroring the /mcp server list.
function SkillList({
  skills,
  selected,
  confirmDelete,
}: {
  skills: Skill[];
  selected: number;
  confirmDelete: string | null;
}) {
  if (skills.length === 0) {
    return (
      <box flexDirection="column" width="100%">
        <text fg="#9aa4b2" wrapMode="word">
          No skills yet. A skill is a set of saved instructions you invoke by
          writing @name in a message.
        </text>
        <text fg="#6b7280" marginTop={1}>
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
      <text fg="#9aa4b2" marginBottom={1}>
        {total} skill{total === 1 ? "" : "s"} · invoke one by writing @name in a
        message.
      </text>

      {hiddenAbove > 0 && <text fg="#4b5674"> ↑ {hiddenAbove} more</text>}
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
              armed ? "#4a2530" : isSelected ? "#233056" : undefined
            }
          >
            <text
              fg={armed ? "#ff9aa8" : isSelected ? "#cfe0ff" : "#8bb4ff"}
              attributes={TextAttributes.BOLD}
            >
              @{name}
            </text>
            {hint.length > 0 && (
              <text fg={isSelected ? "#9fb2d8" : "#6b7280"}>
                {"  "}
                {hint}
              </text>
            )}
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg="#4b5674"> ↓ {hiddenBelow} more</text>}
    </box>
  );
}

// The create/edit form: a single-line name field and a multi-line instructions
// field. Only the focused field takes keystrokes (Tab toggles). The textarea is
// uncontrolled — seeded once via initialValue and remounted per session with
// `editKey` — and read back through the ref on save.
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
  const nameFocused = focusedField === "name";
  return (
    <box flexDirection="column" width="100%">
      <text fg={nameFocused ? "#cfe0ff" : "#8bb4ff"}>Name (used as @name)</text>
      <box
        border
        borderColor={nameFocused ? "#191970" : "#2a3350"}
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

      <text fg={!nameFocused ? "#cfe0ff" : "#8bb4ff"}>
        Instructions (what syd should do when you @mention this)
      </text>
      <box
        border
        borderColor={!nameFocused ? "#191970" : "#2a3350"}
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
        <text fg="#ff9aa8" marginTop={1} wrapMode="word">
          {error}
        </text>
      )}
    </box>
  );
}
