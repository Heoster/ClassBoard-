import type { Annotation } from "../../types/annotation";
export type HistoryState = { past: Annotation[][]; present: Annotation[]; future: Annotation[][] };
export const initialHistory = (annotations: Annotation[] = []): HistoryState => ({ past: [], present: annotations, future: [] });
export function commit(state: HistoryState, next: Annotation[]): HistoryState {
    return { past: [...state.past, state.present], present: next, future: [] };
}
export function undo(state: HistoryState): HistoryState {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
}
export function redo(state: HistoryState): HistoryState {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
}
