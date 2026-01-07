export interface ProjectEntry {
  name: string;
  folder?: string;
}

export interface ProjectFolderResponse {
  name: string;
  projects?: ProjectEntry[];
}

export interface ProjectsResponse {
  folders?: ProjectFolderResponse[];
  projects?: ProjectEntry[];
}

export function buildExistingProjectNames(response: ProjectsResponse): string[] {
  const names = new Set<string>();

  (response.projects || []).forEach((project) => {
    if (project?.name) {
      names.add(project.name);
    }
  });

  (response.folders || []).forEach((folder) => {
    const folderName = folder?.name;
    (folder.projects || []).forEach((project) => {
      if (!project?.name) return;
      if (folderName) {
        names.add(`${folderName}/${project.name}`);
      } else if (project.folder) {
        names.add(`${project.folder}/${project.name}`);
      }
    });
  });

  return Array.from(names);
}

