import type { MclProject, ProjectFiles } from "@manifest-configuration-language/browser";

export function createProjectSession(openProject: (files: ProjectFiles) => MclProject) {
  let projectSession: MclProject | undefined;
  let projectFiles: ProjectFiles = Object.create(null) as ProjectFiles;

  return {
    update(snapshot: ProjectFiles): MclProject {
      if (!projectSession) {
        projectSession = openProject(snapshot);
        projectFiles = snapshot;
        return projectSession;
      }

      const set = Object.create(null) as Record<string, string | Uint8Array>;
      const deleted: string[] = [];
      for (const [path, content] of Object.entries(snapshot)) {
        if (!Object.hasOwn(projectFiles, path) || projectFiles[path] !== content)
          set[path] = content;
      }
      for (const path of Object.keys(projectFiles)) {
        if (!Object.hasOwn(snapshot, path)) deleted.push(path);
      }

      projectSession = projectSession.patch({ set, delete: deleted });
      projectFiles = snapshot;
      return projectSession;
    },
    get files(): ProjectFiles {
      return projectFiles;
    },
  };
}
