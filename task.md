# sydcli — Remaining `ctx` / App.tsx tasks

## Prerequisite (unblocks most items below)

- [ ] Add `messages` state to `App.tsx`
  - `const [messages, setMessages] = useState<Message[]>([]);`
  - Import `Message` type from `./commands/type`

## `ctx` field completion

- [ ] Wire `addSystemMessage` to push a system message into `messages` state (unblocks `/help` output)
- [ ] Extend `newSession` to also clear `messages` (currently only resets title)
- [ ] Add `model` state (`useState("gemini-2.5-flash")`) and wire `setModel` to update it (unblocks `/model`)

## Component wiring

- [ ] Update `ChatMain` to accept a `messages: Message[]` prop and render each message (currently ignores it)
- [ ] Pass `messages` from `App.tsx` into `<ChatMain messages={messages} />`

## Polish (low priority, do last)

- [ ] Upgrade `exit` to call OpenTUI's `renderer.destroy()` before `process.exit(0)` for clean terminal shutdown

## After all of the above

`ctx` is fully real. All slash commands work end-to-end against visible system messages. Ready to plug in the Vercel AI SDK for actual chat.
