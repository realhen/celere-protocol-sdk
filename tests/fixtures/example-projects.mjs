import { execFileSync } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Install a copied project against the candidate tarball, using only cached, locked dependencies. */
export async function installExampleProject(source, directory, tarball, integrity) {
  await cp(source, directory, {
    recursive: true,
    filter: (path) =>
      !relative(source, path)
        .split(sep)
        .some((part) => part === "node_modules" || part === "dist"),
  });
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const sdkManifest = JSON.parse(await readFile("package.json", "utf8"));
  const sdkLock = JSON.parse(await readFile("package-lock.json", "utf8"));
  // The shipped projects pin a GitHub revision until publication. This test must exercise the
  // uncommitted candidate build, without depending on a prior published/remote version.
  manifest.dependencies["celere-protocol-sdk"] = `file:${tarball}`;
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  await writeFile(
    join(directory, "package-lock.json"),
    JSON.stringify({
      name: manifest.name,
      lockfileVersion: 3,
      requires: true,
      packages: {
        ...sdkLock.packages,
        "": {
          name: manifest.name,
          version: manifest.version,
          dependencies: manifest.dependencies,
          devDependencies: manifest.devDependencies,
        },
        "node_modules/celere-protocol-sdk": {
          version: sdkManifest.version,
          resolved: `file:${tarball}`,
          integrity,
          dependencies: sdkManifest.dependencies,
          engines: sdkManifest.engines,
        },
      },
    }),
  );
  execFileSync(
    "npm",
    ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: directory, stdio: "pipe" },
  );
  execFileSync("npm", ["run", "build"], { cwd: directory, stdio: "pipe" });
}
