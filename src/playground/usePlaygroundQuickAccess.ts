import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import type { QuickAccessItem } from "./QuickAccessList";
import { createPlaygroundCommandItems } from "./createPlaygroundCommandItems";
import type { ExampleSpec } from "./usePlaygroundProjectActions";
import type { PlaygroundDefinitionLocation, PlaygroundReference, ProjectFile } from "./types";

type CommandActions = Omit<
  Parameters<typeof createPlaygroundCommandItems>[1],
  "openExamples" | "openFile" | "closePalette"
>;

type Options = {
  t: TFunction<"starlight">;
  examples: ExampleSpec[];
  samples: { configMap: string; deployment: string };
  paths: string[];
  files: Record<string, ProjectFile>;
  recentPaths: string[];
  sourceForPath: (path: string) => string;
  selectFile: (path: string) => void;
  selectSample: (slug: string) => Promise<void>;
  symbolReferences: PlaygroundReference[];
  navigateToDefinition: (reference: PlaygroundDefinitionLocation) => void;
  closeSymbolReferences: () => void;
  setShowProblems: (show: boolean) => void;
  setShowDiff: (show: boolean) => void;
  openExamples: () => void;
  commandActions: CommandActions;
};

export function usePlaygroundQuickAccess({
  t,
  examples,
  samples,
  paths,
  files,
  recentPaths,
  sourceForPath,
  selectFile,
  selectSample,
  symbolReferences,
  navigateToDefinition,
  closeSymbolReferences,
  setShowProblems,
  setShowDiff,
  openExamples,
  commandActions,
}: Options) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const quickOpenItems = useMemo(() => {
    const quickPaths = paths
      .filter((path) => files[path]?.encoding === "utf8" || path === "main.mcl")
      .sort((left, right) => {
        const leftRecent = recentPaths.indexOf(left);
        const rightRecent = recentPaths.indexOf(right);
        if (leftRecent >= 0 || rightRecent >= 0)
          return (
            (leftRecent < 0 ? Infinity : leftRecent) - (rightRecent < 0 ? Infinity : rightRecent)
          );
        return left.localeCompare(right);
      });
    return quickPaths.map((path) => ({
      value: path,
      label: path,
      onSelect: () => {
        setQuickOpen(false);
        selectFile(path);
      },
    }));
  }, [files, paths, recentPaths, selectFile]);

  const symbolReferenceItems: QuickAccessItem[] = useMemo(
    () =>
      symbolReferences.map((reference, index) => {
        const { line, character } = reference.range.start;
        const sourceLine = sourceForPath(reference.path).split(/\r?\n/)[line]?.trim() ?? "";
        const location = `${reference.path}:${line + 1}:${character + 1}`;
        return {
          value: `${location} ${sourceLine} ${index}`,
          label: `${location}  ${sourceLine}`,
          keywords: [reference.path, sourceLine],
          onSelect: () => {
            navigateToDefinition(reference);
            closeSymbolReferences();
            setShowProblems(false);
            setShowDiff(false);
          },
        };
      }),
    [
      closeSymbolReferences,
      navigateToDefinition,
      setShowDiff,
      setShowProblems,
      sourceForPath,
      symbolReferences,
    ],
  );

  const exampleItems: QuickAccessItem[] = useMemo(
    () => [
      {
        value: "configMap",
        label: "ConfigMap",
        group: t("examplesGroupBasics"),
        keywords: [t("examplesGroupBasics"), "variables", "manifest"],
        description: t("exampleConfigMapDescription"),
        preview: samples.configMap.split("\n").slice(0, 6).join("\n"),
        onSelect: () => void selectSample("configMap"),
      },
      {
        value: "deployment",
        label: "Deployment",
        group: t("examplesGroupBasics"),
        keywords: [t("examplesGroupBasics"), "kubernetes", "manifest"],
        description: t("exampleDeploymentDescription"),
        preview: samples.deployment.split("\n").slice(0, 7).join("\n"),
        onSelect: () => void selectSample("deployment"),
      },
      ...examples.map((entry) => ({
        value: entry.slug,
        label: entry.title,
        group: entry.category,
        keywords: [entry.category, entry.slug, ...entry.tags],
        description: entry.description,
        tags: entry.tags,
        difficulty: entry.difficulty,
        preview: entry.preview,
        onSelect: () => void selectSample(entry.slug),
      })),
    ],
    [examples, samples.configMap, samples.deployment, selectSample, t],
  );

  const commandItems = useMemo(
    () =>
      createPlaygroundCommandItems(t, {
        ...commandActions,
        openExamples,
        openFile: () => setQuickOpen(true),
        closePalette: () => setCommandPaletteOpen(false),
      }),
    [commandActions, openExamples, t],
  );

  return {
    commandItems,
    commandPaletteOpen,
    exampleItems,
    quickOpen,
    quickOpenItems,
    setCommandPaletteOpen,
    setQuickOpen,
    symbolReferenceItems,
  };
}
