export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function appPath(path: string) {
  if (!path.startsWith("/")) throw new Error("Application paths must start with /");
  return `${BASE_PATH}${path}`;
}
