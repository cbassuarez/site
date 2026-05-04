// Flat re-export surface bundled into window.CMRepl by build-repl-cm.mjs.
// Anything the repl-editor.js adapter needs at runtime must be re-exported
// here.

export {
  EditorState,
  Compartment,
  StateField,
  StateEffect,
  Prec,
  Transaction,
  RangeSetBuilder,
} from '@codemirror/state';

export {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  keymap,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  rectangularSelection,
  crosshairCursor,
  placeholder,
} from '@codemirror/view';

export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  indentMore,
  indentLess,
  toggleLineComment,
} from '@codemirror/commands';

export {
  HighlightStyle,
  syntaxHighlighting,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';

export {
  autocompletion,
  completionKeymap,
  startCompletion,
  acceptCompletion,
  closeCompletion,
  completionStatus,
} from '@codemirror/autocomplete';

export {
  linter,
  lintGutter,
  lintKeymap,
  setDiagnostics,
} from '@codemirror/lint';

export {
  search,
  searchKeymap,
  highlightSelectionMatches,
} from '@codemirror/search';

export { tags as t } from '@lezer/highlight';
