// Undo and redo for the editor: every action (place, move, turn, edit, duplicate, delete, archive,
// restore, publish) is done through here, which keeps each item's whole state before and after it (the
// draft, the published copy, the archived copy: service.getState) — so undoing puts exactly that back
// (service.setState), whatever the action was. A run of changes to the same thing (dragging, typing) can
// be merged into one step (merge key).
//
//   const h = createHistory(service, { limit })
//   await h.run('Move "Bay sprint"', [id], () => service.update(id, …), { merge: `move:${id}` })
//   await h.undo() / h.redo() → { ok, label }       h.canUndo / h.canRedo / h.undoLabel / h.redoLabel

export function createHistory(service, { limit = 200, mergeMs = 1200, now = () => Date.now() } = {}) {
  const done = [], undone = [], listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };
  const states = async ids => Object.fromEntries(await Promise.all(ids.map(async id => [id, (await service.getState(id)).state])));

  return {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get canUndo() { return done.length > 0; }, get canRedo() { return undone.length > 0; },
    get undoLabel() { return done.at(-1)?.label ?? null; }, get redoLabel() { return undone.at(-1)?.label ?? null; },
    get size() { return done.length; },
    // ids: the items the action touches (a new item's id isn't known until it's made: the result's item.id counts too)
    async run(label, ids, action, { merge = null } = {}) {
      const before = await states(ids);
      const result = await action();
      if (!result?.ok) return result;
      const touched = [...new Set([...ids, ...(result.item?.id ? [result.item.id] : []), ...(result.ids ?? [])])];
      for (const id of touched) if (!(id in before)) before[id] = { draft: null, published: null, archived: null };
      const after = await states(touched), t = now(), last = done.at(-1);
      if (merge && last?.merge === merge && t - last.at < mergeMs) { Object.assign(last.after, after); last.at = t; }
      else { done.push({ label, before, after, merge, at: t }); if (done.length > limit) done.shift(); }
      undone.length = 0;
      emit();
      return result;
    },
    async undo() {
      const step = done.pop();
      if (!step) return { ok: false, error: 'Nothing to undo.' };
      for (const [id, s] of Object.entries(step.before)) await service.setState(id, s);
      undone.push(step); emit();
      return { ok: true, label: step.label, ids: Object.keys(step.before) };
    },
    async redo() {
      const step = undone.pop();
      if (!step) return { ok: false, error: 'Nothing to redo.' };
      for (const [id, s] of Object.entries(step.after)) await service.setState(id, s);
      done.push({ ...step, merge: null }); emit();
      return { ok: true, label: step.label, ids: Object.keys(step.after) };
    },
    clear() { done.length = 0; undone.length = 0; emit(); },
  };
}
