import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGroupRef, usePanelRef, type Layout } from "react-resizable-panels";
import type { ProjectFile } from "./types";

const layoutPreferenceKey = "mcl-playground-layout-v1";

export const defaultPanelLayout: Layout = { editor: 60, output: 40 };

type OutputView = "yaml" | "resources" | "problems" | "diff";
type LayoutPreference = {
  orientation?: "horizontal" | "vertical";
  orientationOverridden?: boolean;
  layout: Layout;
  outputCollapsed?: boolean;
  openPaths?: string[];
  outputView?: OutputView;
};

function readLayoutPreference(): LayoutPreference | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(layoutPreferenceKey) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const preference = value as Record<string, unknown>;
    if (!preference.layout || typeof preference.layout !== "object") return undefined;
    const layout = preference.layout as Record<string, unknown>;
    const outputCollapsed = preference.outputCollapsed === true;
    if (
      typeof layout.editor !== "number" ||
      typeof layout.output !== "number" ||
      !Number.isFinite(layout.editor) ||
      !Number.isFinite(layout.output) ||
      layout.editor <= 0 ||
      (layout.output <= 0 && !outputCollapsed) ||
      Math.abs(layout.editor + layout.output - 100) > 0.01
    )
      return undefined;

    const openPaths = Array.isArray(preference.openPaths)
      ? preference.openPaths.filter((path): path is string => typeof path === "string")
      : undefined;
    const outputView =
      preference.outputView === "yaml" ||
      preference.outputView === "resources" ||
      preference.outputView === "problems" ||
      preference.outputView === "diff"
        ? preference.outputView
        : undefined;

    const orientation =
      preference.orientation === "horizontal" || preference.orientation === "vertical"
        ? preference.orientation
        : undefined;
    const orientationOverridden = preference.orientationOverridden === true && orientation;
    return {
      ...(orientation ? { orientation } : {}),
      ...(orientationOverridden ? { orientationOverridden: true } : {}),
      layout: { editor: layout.editor, output: layout.output },
      ...(outputCollapsed ? { outputCollapsed } : {}),
      ...(openPaths ? { openPaths } : {}),
      ...(outputView ? { outputView } : {}),
    };
  } catch {
    return undefined;
  }
}

function writeLayoutPreference(preference: Partial<LayoutPreference>) {
  try {
    const stored = JSON.parse(localStorage.getItem(layoutPreferenceKey) ?? "null");
    const current = stored && typeof stored === "object" ? stored : {};
    localStorage.setItem(layoutPreferenceKey, JSON.stringify({ ...current, ...preference }));
  } catch {
    // Layout preferences are optional when browser storage is unavailable.
  }
}

export function usePlaygroundLayout() {
  const panelGroup = useGroupRef();
  const outputPanel = usePanelRef();
  const workspace = useRef<HTMLElement | null>(null);
  const workspacePreferenceLoaded = useRef(false);
  const expandedLayout = useRef<Layout>(defaultPanelLayout);
  const lastRestorableOutputView = useRef<OutputView>("yaml");
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [orientationOverridden, setOrientationOverridden] = useState(false);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [outputView, setOutputView] = useState<OutputView>("yaml");
  const [openPaths, setOpenPaths] = useState(["main.mcl"]);

  const showDiff = outputView === "diff";
  const showProblems = outputView === "problems";
  const showResources = outputView === "resources";
  const setShowDiff = useCallback((show: boolean) => {
    setOutputView((current) => (show ? "diff" : current === "diff" ? "yaml" : current));
  }, []);
  const setShowProblems = useCallback((show: boolean) => {
    setOutputView((current) => (show ? "problems" : current === "problems" ? "yaml" : current));
  }, []);
  const setShowResources = useCallback((show: boolean) => {
    setOutputView((current) => (show ? "resources" : current === "resources" ? "yaml" : current));
  }, []);
  const savePreference = useCallback((preference: Partial<LayoutPreference>) => {
    writeLayoutPreference(preference);
  }, []);
  const savePanelLayout = useCallback(
    (layout: Layout) => {
      if (layout.output > 0) {
        expandedLayout.current = layout;
        setOutputCollapsed(false);
        savePreference({ orientation, layout, outputCollapsed: false });
        return;
      }
      setOutputCollapsed(true);
      savePreference({ orientation, layout: expandedLayout.current, outputCollapsed: true });
    },
    [orientation, savePreference],
  );

  const applyWorkspacePreference = useCallback(
    (files: Record<string, ProjectFile>, activePath: string, fresh: boolean) => {
      const preference = fresh ? undefined : readLayoutPreference();
      const availablePaths = new Set(["main.mcl", ...Object.keys(files)]);
      const savedOpenPaths = preference?.openPaths?.filter(
        (path) =>
          availablePaths.has(path) && (path === "main.mcl" || files[path]?.encoding === "utf8"),
      );
      setOpenPaths(
        savedOpenPaths?.length ? [...new Set([activePath, ...savedOpenPaths])] : [activePath],
      );
      setOutputView(
        fresh || preference?.outputView === "diff" ? "yaml" : (preference?.outputView ?? "yaml"),
      );
      workspacePreferenceLoaded.current = true;
    },
    [],
  );

  useEffect(() => {
    if (!workspacePreferenceLoaded.current) return;
    const persistedOutputView =
      outputView === "diff" ? lastRestorableOutputView.current : outputView;
    if (outputView !== "diff") lastRestorableOutputView.current = outputView;
    writeLayoutPreference({ openPaths, outputView: persistedOutputView });
  }, [openPaths, outputView]);

  useEffect(() => {
    const preference = readLayoutPreference();
    if (!preference) return;
    if (preference.orientationOverridden && preference.orientation) {
      setOrientationOverridden(true);
      setOrientation(preference.orientation);
    }
    panelGroup.current?.setLayout(preference.layout);
    expandedLayout.current = preference.layout;
    if (preference.outputCollapsed) {
      outputPanel.current?.collapse();
      setOutputCollapsed(true);
    }
  }, [outputPanel, panelGroup]);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? element.clientWidth;
      if (!orientationOverridden) setOrientation(width >= 1100 ? "horizontal" : "vertical");
      const output = outputPanel.current;
      if (output && width < 700 && output.isCollapsed()) {
        output.expand();
      } else if (output && width >= 700 && outputCollapsed && !output.isCollapsed()) {
        output.collapse();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [orientationOverridden, outputCollapsed, outputPanel]);

  const toggleOrientation = useCallback(() => {
    const nextOrientation = orientation === "vertical" ? "horizontal" : "vertical";
    setOrientationOverridden(true);
    setOrientation(nextOrientation);
    const currentLayout = outputPanel.current?.isCollapsed()
      ? expandedLayout.current
      : (panelGroup.current?.getLayout() ?? defaultPanelLayout);
    writeLayoutPreference({
      orientation: nextOrientation,
      orientationOverridden: true,
      layout: currentLayout,
    });
  }, [orientation, outputPanel, panelGroup]);

  const toggleOutputPanel = useCallback(() => {
    const panel = outputPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setOutputCollapsed(false);
      savePreference({
        layout: expandedLayout.current,
        outputCollapsed: false,
      });
      return;
    }
    const currentLayout = panelGroup.current?.getLayout();
    if (currentLayout) expandedLayout.current = currentLayout;
    panel.collapse();
    setOutputCollapsed(true);
    savePreference({
      layout: expandedLayout.current,
      outputCollapsed: true,
    });
  }, [outputPanel, panelGroup, savePreference]);

  return {
    applyWorkspacePreference,
    defaultPanelLayout,
    openPaths,
    orientation,
    outputCollapsed,
    outputPanel,
    panelGroup,
    savePanelLayout,
    savePreference,
    setOpenPaths,
    setOrientationOverridden,
    setShowDiff,
    setShowProblems,
    setShowResources,
    showDiff,
    showProblems,
    showResources,
    toggleOrientation,
    toggleOutputPanel,
    workspace,
  };
}
