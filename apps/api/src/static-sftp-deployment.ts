import { createHash } from "node:crypto";
import { posix } from "node:path";
import SftpClient from "ssh2-sftp-client";
import type { WebsiteRenderFile } from "@webtummy/core/website-renderer";

export type StaticSftpConnection = {
  host: string;
  port: number;
  username: string;
  password: string;
  rootPath: string;
};

const normalizedRoot = (value: string) => {
  const root = posix.normalize(`/${value.trim().replace(/^\/+/, "")}`);
  return root === "/." ? "/" : root.replace(/\/+$/, "") || "/";
};

export function staticRemotePath(rootPath: string, filePath: string) {
  const root = normalizedRoot(rootPath);
  const safeFile = posix.normalize(filePath.replace(/^\/+/, ""));
  if (!safeFile || safeFile === "." || safeFile.startsWith("../") || safeFile.includes("/../")) {
    throw new Error(`Unsafe static deployment path: ${filePath}`);
  }
  const remote = posix.join(root, safeFile);
  if (root !== "/" && remote !== root && !remote.startsWith(`${root}/`)) {
    throw new Error(`Static deployment path escapes the configured web root: ${filePath}`);
  }
  return remote;
}

export function staticRenderFileBuffer(file: WebsiteRenderFile) {
  return Buffer.from(file.content, file.base64 ? "base64" : "utf8");
}

const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

export async function deployStaticFilesOverSftp(input: {
  connection: StaticSftpConnection;
  files: WebsiteRenderFile[];
  releaseId: string;
}) {
  const client = new SftpClient(`senuke-static-${input.releaseId}`);
  const root = normalizedRoot(input.connection.rootPath);
  const backupLabel = `${new Date().toISOString().replace(/[:.]/g, "-")}-${input.releaseId.replace(/[^a-z0-9_-]/gi, "-").slice(-24)}`;
  const backupRoot = posix.join(root, ".senuke-backups", backupLabel);
  const touched: Array<{ target: string; backup: string | null }> = [];
  let uploadedBytes = 0;

  try {
    await client.connect({
      host: input.connection.host,
      port: input.connection.port,
      username: input.connection.username,
      password: input.connection.password,
      readyTimeout: 20_000,
      retries: 1,
    });
    if (await client.exists(root) !== "d") {
      throw new Error(`The configured hosting path ${root} does not exist or is not a directory.`);
    }

    for (const file of input.files) {
      const target = staticRemotePath(root, file.path);
      const directory = posix.dirname(target);
      await client.mkdir(directory, true);
      const existingType = await client.exists(target);
      let backup: string | null = null;
      if (existingType === "-") {
        backup = staticRemotePath(backupRoot, file.path);
        await client.mkdir(posix.dirname(backup), true);
        const existing = await client.get(target);
        await client.put(Buffer.isBuffer(existing) ? existing : Buffer.from(String(existing)), backup);
      } else if (existingType && existingType !== "-") {
        throw new Error(`Cannot replace ${target} because it is not a regular file.`);
      }

      const body = staticRenderFileBuffer(file);
      touched.push({ target, backup });
      await client.put(body, target);
      const remote = await client.get(target);
      const remoteBody = Buffer.isBuffer(remote) ? remote : Buffer.from(String(remote));
      if (remoteBody.length !== body.length || sha256(remoteBody) !== sha256(body)) {
        throw new Error(`Remote verification failed for ${file.path}.`);
      }
      uploadedBytes += body.length;
    }

    return {
      rootPath: root,
      backupPath: touched.some((item) => item.backup) ? backupRoot : null,
      fileCount: touched.length,
      uploadedBytes,
      files: input.files.map((file) => ({
        path: file.path,
        bytes: staticRenderFileBuffer(file).length,
        sha256: sha256(staticRenderFileBuffer(file)),
      })),
    };
  } catch (error) {
    for (const item of [...touched].reverse()) {
      try {
        if (item.backup) {
          const previous = await client.get(item.backup);
          await client.put(Buffer.isBuffer(previous) ? previous : Buffer.from(String(previous)), item.target);
        } else if (await client.exists(item.target) === "-") {
          await client.delete(item.target);
        }
      } catch {
        // Preserve the original deployment error. The retained backup path is
        // still available for an operator if the automatic restore is blocked.
      }
    }
    throw error;
  } finally {
    try {
      await client.end();
    } catch {
      // The original operation already carries the useful connection result.
    }
  }
}
