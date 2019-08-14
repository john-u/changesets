import { copyFixtureIntoTempDir } from "jest-fixtures";

import fs from "fs-extra";
import path from "path";
import versionCommand from "../index";
import * as git from "@changesets/git";
import logger from "../../../utils/logger";
import writeChangeset from "../../add/writeChangeset";
import { NewChangeset } from "@changesets/types";
import { defaultConfig } from "@changesets/config";

// avoid polluting test logs with error message in console
// This is from bolt's error log
const consoleError = console.error;

jest.mock("../../../utils/cli");
jest.mock("@changesets/git");
jest.mock("../../../utils/logger");

// @ts-ignore
git.add.mockImplementation(() => Promise.resolve(true));
// @ts-ignore
git.commit.mockImplementation(() => Promise.resolve(true));
// @ts-ignore
git.tag.mockImplementation(() => Promise.resolve(true));

const simpleChangeset: NewChangeset = {
  summary: "This is a summary",
  releases: [{ name: "pkg-a", type: "minor" }],
  id: "having-lotsof-fun"
};

const simpleChangeset2: NewChangeset = {
  summary: "This is a summary",
  releases: [
    { name: "pkg-a", type: "minor" },
    { name: "pkg-b", type: "patch" }
  ],
  id: "wouldnit-be-nice"
};

const writeChangesets = (changesets: NewChangeset[], cwd: string) => {
  return Promise.all(
    changesets.map(changeset => writeChangeset(changeset, cwd))
  );
};

const writeEmptyChangeset = (cwd: string) => writeChangesets([], cwd);

describe("running version in a simple project", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await copyFixtureIntoTempDir(__dirname, "simple-project");
    console.error = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    console.error = consoleError;
  });

  describe("when there are no changeset commits", () => {
    it("should warn if no changeset commits exist", async () => {
      await writeEmptyChangeset(cwd);
      await versionCommand(cwd, defaultConfig);
      const loggerWarnCalls = logger.warn.mock.calls;
      expect(loggerWarnCalls.length).toEqual(1);
      expect(loggerWarnCalls[0][0]).toEqual(
        "No unreleased changesets found, exiting."
      );
    });
  });

  describe("When there is a changeset commit", () => {
    it("should bump releasedPackages", async () => {
      const spy = jest.spyOn(fs, "writeFile");
      await writeChangesets([simpleChangeset2], cwd);

      await versionCommand(cwd, defaultConfig);
      const calls = spy.mock.calls;

      expect(JSON.parse(calls[0][1])).toEqual(
        expect.objectContaining({ name: "pkg-a", version: "1.1.0" })
      );
      expect(JSON.parse(calls[1][1])).toEqual(
        expect.objectContaining({ name: "pkg-b", version: "1.0.1" })
      );
    });

    it("should git add the expected files (without changelog) when commit: true", async () => {
      await writeChangesets([simpleChangeset2], cwd);
      await versionCommand(cwd, { ...defaultConfig, commit: true });

      const pkgAConfigPath = path.join(cwd, "packages/pkg-a/package.json");
      const pkgBConfigPath = path.join(cwd, "packages/pkg-b/package.json");
      const changesetConfigPath = path.join(cwd, ".changeset");

      expect(git.add).toHaveBeenCalledWith(pkgAConfigPath, cwd);
      expect(git.add).toHaveBeenCalledWith(pkgBConfigPath, cwd);
      expect(git.add).toHaveBeenCalledWith(changesetConfigPath, cwd);
    });
    it("should git add the expected files (with changelog)", async () => {
      let changelogPath = path.resolve(__dirname, "../../changelogs");
      await writeChangesets([simpleChangeset2], cwd);
      await versionCommand(cwd, {
        ...defaultConfig,
        changelog: [changelogPath, null],
        commit: true
      });
      const pkgAChangelogPath = path.join(cwd, "packages/pkg-a/CHANGELOG.md");
      const pkgBChangelogPath = path.join(cwd, "packages/pkg-b/CHANGELOG.md");
      expect(git.add).toHaveBeenCalledWith(pkgAChangelogPath, cwd);
      expect(git.add).toHaveBeenCalledWith(pkgBChangelogPath, cwd);
    });
  });

  it("should respect config file", async () => {
    // We have used the atlaskit config. Its two differences are it has skipCI and commit as true
    const cwd2 = await copyFixtureIntoTempDir(
      __dirname,
      "simple-project-custom-config"
    );
    await writeChangesets([simpleChangeset2], cwd2);
    await versionCommand(cwd2, defaultConfig);

    expect(git.commit).toHaveBeenCalledTimes(1);
  });

  it("should bump packages to the correct versions when packages are linked", async () => {
    const cwd2 = await copyFixtureIntoTempDir(__dirname, "linked-packages");
    const spy = jest.spyOn(fs, "writeFile");
    await writeChangesets([simpleChangeset2], cwd2);

    await versionCommand(cwd2, defaultConfig);
    const calls = spy.mock.calls;

    expect(JSON.parse(calls[0][1])).toEqual(
      expect.objectContaining({ name: "pkg-a", version: "1.1.0" })
    );
    expect(JSON.parse(calls[1][1])).toEqual(
      expect.objectContaining({ name: "pkg-b", version: "1.1.0" })
    );
  });

  it("should not break when there is a linked package without a changeset", async () => {
    const cwd2 = await copyFixtureIntoTempDir(__dirname, "linked-packages");
    const spy = jest.spyOn(fs, "writeFile");
    await writeChangesets([simpleChangeset], cwd2);

    await versionCommand(cwd2, defaultConfig);
    const calls = spy.mock.calls;

    expect(JSON.parse(calls[0][1])).toEqual(
      expect.objectContaining({ name: "pkg-a", version: "1.1.0" })
    );

    expect(spy).toHaveBeenCalledTimes(2);
  });

  describe("when there are multiple changeset commits", () => {
    it("should bump releasedPackages", async () => {
      await writeChangesets([simpleChangeset, simpleChangeset2], cwd);
      const spy = jest.spyOn(fs, "writeFile");

      await versionCommand(cwd, defaultConfig);
      const calls = spy.mock.calls;
      expect(JSON.parse(calls[0][1])).toEqual(
        expect.objectContaining({ name: "pkg-a", version: "1.1.0" })
      );
      expect(JSON.parse(calls[1][1])).toEqual(
        expect.objectContaining({ name: "pkg-b", version: "1.0.1" })
      );
    });

    it("should bump multiple released packages if required", async () => {
      await writeChangesets([simpleChangeset, simpleChangeset2], cwd);
      const spy = jest.spyOn(fs, "writeFile");
      await versionCommand(cwd, defaultConfig);
      const calls = spy.mock.calls;

      // first call should be minor bump
      expect(JSON.parse(calls[0][1])).toEqual(
        expect.objectContaining({
          name: "pkg-a",
          version: "1.1.0"
        })
      );
      // second should be a patch
      expect(JSON.parse(calls[1][1])).toEqual(
        expect.objectContaining({
          name: "pkg-b",
          version: "1.0.1"
        })
      );
    });
    it("should delete the changeset folders", async () => {
      await writeChangesets([simpleChangeset, simpleChangeset2], cwd);
      await versionCommand(cwd, defaultConfig);

      const dirs = await fs.readdir(path.resolve(cwd, ".changeset"));
      expect(dirs.length).toBe(1);
    });
  });
});