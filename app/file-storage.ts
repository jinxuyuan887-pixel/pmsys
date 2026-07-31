function localStorageRoot() {
  return process.env.NODE_FILE_STORAGE_PATH;
}

async function localPath(key: string) {
  const root = localStorageRoot();
  if (!root) return null;
  const { resolve, sep } = await import("node:path");
  const base = resolve(root);
  const target = resolve(base, key);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error("Invalid storage key");
  }
  return target;
}

export async function putFile(key: string, value: ArrayBuffer) {
  const target = await localPath(key);
  if (target) {
    const { dirname } = await import("node:path");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(value));
    return;
  }
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.put(key, value);
}

export async function getFile(key: string) {
  const target = await localPath(key);
  if (target) {
    const { readFile } = await import("node:fs/promises");
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(key);
  return object?.body ?? null;
}

export async function deleteFile(key: string) {
  const target = await localPath(key);
  if (target) {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(target);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    return;
  }
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.delete(key);
}
