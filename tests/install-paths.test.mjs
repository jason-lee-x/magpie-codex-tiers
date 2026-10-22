import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

// 只执行路径区段，避免导入 hook 启动网络与定时器；所有配置均在临时目录。
const source = fs.readFileSync(new URL("../reset.hooks.js", import.meta.url), "utf8");
const section = source.slice(source.indexOf("// ---- 路径"), source.indexOf("// ---- 数据源"));
assert.ok(section.includes("function findEntry"));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "magpie-install-paths-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const config = path.join(root, "portable", "data");
  const dir = path.join(config, "plugins", "node_modules", "magpie-codex-tiers");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  function write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  function load({ cwd = config, pluginDir = dir, env = {}, platform = process.platform, filesystem = fs } = {}) {
    const sandbox = { fs: filesystem, path, os: { homedir: () => home }, fileURLToPath,
      process: { cwd: () => cwd, env, platform },
      moduleURL: pathToFileURL(path.join(pluginDir, "reset.hooks.js")).href };
    vm.createContext(sandbox);
    vm.runInContext(section.replace("import.meta.url", "moduleURL"), sandbox);
    return sandbox;
  }
  return { root, home, config, dir, write, load };
}

test("GitHub specs resolve through Bun dependencies, independent of repository name", (t) => {
  const f = fixture(t);
  for (const spec of ["github:owner/different-repo#v1.0.0", "owner/different-repo#main", "git+https://github.com/owner/repo.git", "https://github.com/owner/repo"]) {
    const entry = { spec, options: { reset: { enabled: true } } };
    f.write(path.join(f.config, "plugins.json"), { plugins: [entry] });
    f.write(path.join(f.config, "plugins", "package.json"), { dependencies: { "magpie-codex-tiers": spec } });
    const api = f.load();
    assert.equal(api.magpieDir(), f.config);
    assert.equal(api.findEntry({ plugins: [entry] }, f.dir), entry);
  }
});

test("npm plain/version/tag and scoped names resolve to installed directories", (t) => {
  const f = fixture(t);
  const api = f.load();
  for (const spec of ["magpie-codex-tiers", "magpie-codex-tiers@latest", "magpie-codex-tiers@1.0.0"]) {
    const entry = { spec };
    assert.equal(api.findEntry({ plugins: [entry] }, f.dir, f.config), entry);
  }
  const scoped = path.join(f.config, "plugins", "node_modules", "@owner", "tiers");
  fs.mkdirSync(scoped, { recursive: true });
  const entry = { spec: "@owner/tiers@1.0.0" };
  assert.equal(api.findEntry({ plugins: [entry] }, scoped, f.config), entry);
});

test("local paths, file URLs and relative paths resolve without package metadata", (t) => {
  const f = fixture(t);
  const api = f.load();
  for (const spec of [f.dir, pathToFileURL(f.dir).href, "./plugins/node_modules/magpie-codex-tiers"]) {
    const entry = { spec };
    assert.equal(api.findEntry({ plugins: [entry] }, f.dir, f.config), entry);
  }
});

test("portable cwd wins over XDG only after verifying plugin ownership", (t) => {
  const f = fixture(t);
  f.write(path.join(f.config, "plugins.json"), { plugins: [{ spec: f.dir }] });
  const xdg = path.join(f.root, "xdg");
  const installed = path.join(xdg, "magpie");
  f.write(path.join(installed, "plugins.json"), { plugins: [{ spec: f.dir }] });
  assert.equal(f.load({ env: { XDG_CONFIG_HOME: xdg } }).magpieDir(), f.config);
  const unrelated = path.join(f.root, "unrelated");
  f.write(path.join(unrelated, "plugins.json"), { plugins: [{ spec: "magpie-codex-tiers@latest" }] });
  assert.equal(f.load({ cwd: unrelated, env: { XDG_CONFIG_HOME: xdg } }).magpieDir(), installed);
  assert.throws(() => f.load({ cwd: unrelated }).magpieDir(), /无法定位/);
});

test("home fallback is verified and relative XDG is ignored", (t) => {
  const f = fixture(t);
  const installed = path.join(f.home, ".config", "magpie");
  f.write(path.join(installed, "plugins.json"), { plugins: [{ spec: f.dir }] });
  assert.equal(f.load({ cwd: f.home, env: { XDG_CONFIG_HOME: "relative" } }).magpieDir(), installed);
});

test("missing Git mapping, malformed entries and traversal names cannot claim ownership", (t) => {
  const f = fixture(t);
  const api = f.load();
  const spec = "github:owner/repo";
  const list = { plugins: [null, {}, { spec: 42 }, { spec }] };
  assert.equal(api.findEntry(list, f.dir, f.config), null);
  f.write(path.join(f.config, "plugins", "package.json"), { dependencies: { "../../outside": spec } });
  assert.equal(api.findEntry(list, f.dir, f.config), null);
  assert.equal(api.findEntry({ plugins: [{ spec: "missing@latest" }] }, f.dir, f.config), null);
});

test("symlink installation resolves to the real plugin directory", (t) => {
  const f = fixture(t);
  const real = path.join(f.root, "real-plugin");
  fs.mkdirSync(real);
  const link = path.join(f.config, "plugins", "node_modules", "linked-plugin");
  fs.symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
  f.write(path.join(f.config, "plugins.json"), { plugins: [{ spec: "linked-plugin@latest" }] });
  const api = f.load({ pluginDir: real });
  assert.equal(api.samePath(link, real), true);
  assert.equal(api.magpieDir(), f.config);
});

test("Linux paths retain case while Windows canonical paths compare case-insensitively", (t) => {
  const f = fixture(t);
  // Windows 无法创建两个仅大小写不同的目录，因此模拟 realpath 的 Linux 返回值。
  const filesystem = { ...fs, realpathSync: (value) => value };
  const linux = f.load({ platform: "linux", filesystem });
  assert.equal(linux.samePath("/tmp/Plugin", "/tmp/plugin"), false);
  assert.equal(linux.samePath("/tmp/Plugin", "/tmp/Plugin"), true);
  const windows = f.load({ platform: "win32", filesystem });
  assert.equal(windows.samePath("C:\\Plugin", "c:\\plugin"), true);
  assert.equal(linux.samePath(null, "/tmp/plugin"), false);
});
