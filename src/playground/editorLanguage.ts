import { autocompletion, snippetCompletion, type Completion } from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";
import { EditorView, type KeyBinding } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type {
  PlaygroundCompletionItem,
  PlaygroundDefinitionLocation,
  PlaygroundHover,
} from "./types";

type Position = { line: number; character: number };
type CompletionItemMetadata = PlaygroundCompletionItem & {
  detail?: unknown;
  documentation?: unknown;
};

type LanguageServiceCallbacks = {
  onComplete: (path: string, position: Position) => Promise<PlaygroundCompletionItem[]>;
  onDefinition: (path: string, position: Position) => Promise<PlaygroundDefinitionLocation | null>;
  onHover: (path: string, position: Position) => Promise<PlaygroundHover | null>;
  onNavigate: (location: PlaygroundDefinitionLocation) => void;
  onError: (error: Error) => void;
};

type Ref<T> = { current: T };

type LanguageServiceContext = {
  callbacks: Ref<LanguageServiceCallbacks>;
  currentPath: Ref<string>;
  view: Ref<EditorView | undefined>;
  documentGeneration: Ref<number>;
  definitionRequest: Ref<number>;
  hoverRequest: Ref<number>;
};

const starterCompletions = [
  {
    trigger: "let",
    completion: snippetCompletion("let ${1:name} = ${0:null}", {
      label: "let declaration",
      detail: "MCL snippet",
      type: "keyword",
    }),
  },
  {
    trigger: "emit",
    completion: snippetCompletion("emit ${0:resource}", {
      label: "emit statement",
      detail: "MCL snippet",
      type: "keyword",
    }),
  },
  {
    trigger: "node",
    completion: snippetCompletion(
      'node:\n  apiVersion: "${1:v1}"\n  kind: "${2:ConfigMap}"\n  metadata:\n    name: "${3:resource-name}"\n  data:\n    ${4:key}: "${5:value}"\n$0',
      {
        label: "node: ConfigMap resource",
        detail: "MCL snippet",
        type: "keyword",
      },
    ),
  },
];

export function createEditorLanguageServices(context: LanguageServiceContext): {
  extensions: Extension[];
  definitionKeyBinding: KeyBinding;
  definitionMouseHandler: Extension;
} {
  return {
    extensions: [
      autocompletion({
        activateOnTypingDelay: 120,
        defaultKeymap: false,
        override: [
          async (completionContext) => {
            const view = context.view.current;
            const requestPath = context.currentPath.current;
            const requestGeneration = context.documentGeneration.current;
            const requestDocument = completionContext.state.doc;
            if (!view || !requestPath.endsWith(".mcl")) return null;
            const word = completionContext.matchBefore(/[\w.-]*/);
            if (!completionContext.explicit && (!word || word.from === word.to)) return null;
            const line = completionContext.state.doc.lineAt(completionContext.pos);
            try {
              const items = await context.callbacks.current.onComplete(requestPath, {
                line: line.number - 1,
                character: completionContext.pos - line.from,
              });
              if (
                completionContext.aborted ||
                context.view.current !== view ||
                context.currentPath.current !== requestPath ||
                context.documentGeneration.current !== requestGeneration ||
                view.state.doc !== requestDocument
              )
                return null;
              const options: Completion[] = items.map((item) => {
                const metadata = item as CompletionItemMetadata;
                return {
                  label: item.label,
                  type: completionType(item.kind),
                  ...(typeof metadata.detail === "string" ? { detail: metadata.detail } : {}),
                  ...(typeof metadata.documentation === "string"
                    ? { info: metadata.documentation }
                    : {}),
                  ...(item.insertText === undefined ? {} : { apply: item.insertText }),
                };
              });
              const labels = new Set(options.map((option) => option.label));
              for (const starter of starterCompletions) {
                if (word?.text !== starter.trigger || labels.has(starter.completion.label))
                  continue;
                options.push(starter.completion);
              }
              if (options.length === 0) return null;
              return { from: word?.from ?? completionContext.pos, options };
            } catch (cause) {
              if (
                !completionContext.aborted &&
                context.view.current === view &&
                context.currentPath.current === requestPath &&
                context.documentGeneration.current === requestGeneration &&
                view.state.doc === requestDocument
              )
                context.callbacks.current.onError(
                  cause instanceof Error ? cause : new Error(String(cause)),
                );
              return null;
            }
          },
        ],
      }),
      hoverTooltip(
        async (view, position) => {
          const requestId = ++context.hoverRequest.current;
          const requestGeneration = context.documentGeneration.current;
          const requestPath = context.currentPath.current;
          if (!requestPath.endsWith(".mcl")) return null;
          const requestDocument = view.state.doc;
          const line = view.state.doc.lineAt(position);
          try {
            const hover = await context.callbacks.current.onHover(requestPath, {
              line: line.number - 1,
              character: position - line.from,
            });
            if (
              !isCurrentRequest(
                context,
                view,
                requestId,
                requestGeneration,
                requestPath,
                requestDocument,
                context.hoverRequest,
              )
            )
              return null;
            if (!hover) return null;
            const fromLine = view.state.doc.line(
              Math.min(hover.range.start.line + 1, view.state.doc.lines),
            );
            const toLine = view.state.doc.line(
              Math.min(hover.range.end.line + 1, view.state.doc.lines),
            );
            const from = Math.min(fromLine.to, fromLine.from + hover.range.start.character);
            const to = Math.max(from, Math.min(toLine.to, toLine.from + hover.range.end.character));
            return {
              pos: from,
              end: to,
              create() {
                const dom = document.createElement("div");
                dom.className = "cm-tooltip-hover";
                dom.textContent = hover.contents;
                return { dom };
              },
            };
          } catch (cause) {
            if (
              isCurrentRequest(
                context,
                view,
                requestId,
                requestGeneration,
                requestPath,
                requestDocument,
                context.hoverRequest,
              )
            )
              context.callbacks.current.onError(
                cause instanceof Error ? cause : new Error(String(cause)),
              );
            return null;
          }
        },
        { hoverTime: 450, hideOnChange: true },
      ),
    ],
    definitionKeyBinding: {
      key: "F12",
      run: (view) => {
        void goToDefinition(context, view, view.state.selection.main.head);
        return true;
      },
    },
    definitionMouseHandler: EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;
        event.preventDefault();
        void goToDefinition(context, view, position);
        return true;
      },
    }),
  };
}

async function goToDefinition(context: LanguageServiceContext, view: EditorView, position: number) {
  if (!context.currentPath.current.endsWith(".mcl")) return;
  const requestId = ++context.definitionRequest.current;
  const requestGeneration = context.documentGeneration.current;
  const requestPath = context.currentPath.current;
  const requestDocument = view.state.doc;
  const line = view.state.doc.lineAt(position);
  try {
    const location = await context.callbacks.current.onDefinition(requestPath, {
      line: line.number - 1,
      character: position - line.from,
    });
    if (
      !isCurrentRequest(
        context,
        view,
        requestId,
        requestGeneration,
        requestPath,
        requestDocument,
        context.definitionRequest,
      )
    )
      return;
    if (location) context.callbacks.current.onNavigate(location);
  } catch (cause) {
    if (
      !isCurrentRequest(
        context,
        view,
        requestId,
        requestGeneration,
        requestPath,
        requestDocument,
        context.definitionRequest,
      )
    )
      return;
    context.callbacks.current.onError(cause instanceof Error ? cause : new Error(String(cause)));
  }
}

function isCurrentRequest(
  context: LanguageServiceContext,
  view: EditorView,
  requestId: number,
  requestGeneration: number,
  requestPath: string,
  requestDocument: EditorView["state"]["doc"],
  request: Ref<number>,
): boolean {
  return (
    request.current === requestId &&
    context.documentGeneration.current === requestGeneration &&
    context.view.current === view &&
    context.currentPath.current === requestPath &&
    view.state.doc === requestDocument
  );
}

function completionType(kind: number): Completion["type"] {
  switch (kind) {
    case 2:
      return "method";
    case 3:
      return "function";
    case 5:
    case 10:
      return "property";
    case 6:
      return "variable";
    case 7:
      return "class";
    case 8:
      return "type";
    case 9:
      return "namespace";
    case 14:
      return "keyword";
    case 21:
      return "constant";
    default:
      return "text";
  }
}
