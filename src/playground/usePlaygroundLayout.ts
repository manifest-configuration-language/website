import { useCallback, useEffect, useRef, useState } from "react";
import { useGroupRef, type Layout } from "react-resizable-panels";
import type { ProjectFile } from "./types";

const layoutPreferenceKey = "mcl-playground-layout-v1";

export const defaultPanelLayout: Layout = { editor: 60, output: 40 };

type OutputView = "yaml" | "resources" | "problems" | "diff";
type LayoutPreference = {
  orientation: "horizontal" | "vertical";
  layout: Layout;
  openPaths?: string[];
  outputView?: OutputView;
};

function readLayoutPreference(): LayoutPreference | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(layoutPreferenceKey) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const preference = value as Record<string, unknown>;
    if (preference.orientation !== "horizontal" && preference.orientation !== "vertical")
      return undefined;
    if (!preference.layout || typeof preference.layout !== "object") return undefined;
    const layout = preference.layout as Record<string, unknown>;
    if (
      typeof layout.editor !== "number" ||
      typeof layout.output !== "number" ||
      !Number.isFinite(layout.editor) ||
      !Number.isFinite(layout.output) ||
      layout.editor <= 0 ||
      layout.output <= 0 ||
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

    return {
      orientation: preference.orientation,
      layout: { editor: layout.editor, output: layout.output },
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
  const workspace = useRef<HTMLElement | null>(null);
  const workspacePreferenceLoaded = useRef(false);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [orientationOverridden, setOrientationOverridden] = useState(false);
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
    writeLayoutPreference({ openPaths, outputView });
  }, [openPaths, outputView]);

  useEffect(() => {
    const preference = readLayoutPreference();
    if (!preference) return;
    setOrientationOverridden(true);
    setOrientation(preference.orientation);
    panelGroup.current?.setLayout(preference.layout);
  }, [panelGroup]);

  useEffect(() => {
    const element = workspace.current;
    if (!element || orientationOverridden) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? element.clientWidth;
      setOrientation(width >= 1100 ? "horizontal" : "vertical");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [orientationOverridden]);

  const toggleOrientation = useCallback(() => {
    const nextOrientation = orientation === "vertical" ? "horizontal" : "vertical";
    setOrientationOverridden(true);
    setOrientation(nextOrientation);
    writeLayoutPreference({
      orientation: nextOrientation,
      layout: panelGroup.current?.getLayout() ?? defaultPanelLayout,
    });
  }, [orientation, panelGroup]);

  return {
    applyWorkspacePreference,
    defaultPanelLayout,
    openPaths,
    orientation,
    panelGroup,
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
    workspace,
  };
}
